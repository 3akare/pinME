/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import fc from "fast-check";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { OutboxStorage } from "./outbox";
import { PinMailbox, type MailboxRpc, type PinMailboxDeps } from "./PinMailbox";

const SENDER = "AAAAAAAA";
const RECIPIENT = "BBBBBBBB";
const NONCE = "A".repeat(32); // 24 bytes
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

class FakeStorage implements OutboxStorage {
  map = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(k: string) {
    return this.map.get(k) as T | undefined;
  }
  async put<T>(k: string, v: T) {
    this.map.set(k, v);
  }
  async delete(k: string) {
    return this.map.delete(k);
  }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map([...this.map].filter(([k]) => k.startsWith(prefix))) as Map<string, T>;
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(t: number) {
    this.alarm = t;
  }
}

class FakeSocket {
  sent: Record<string, unknown>[] = [];
  constructor(private att: unknown) {}
  deserializeAttachment() {
    return this.att;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
}

type Directory = { accepted: boolean };
const dirOf = (d: Directory) => () =>
  ({
    isContactPair: async () => {
      return d.accepted;
    },
    lookupPin: async () => ({ state: "active" }),
  }) as never;

let realState: DurableObjectState | undefined;

interface Node {
  storage: FakeStorage;
  socket: FakeSocket;
  mailbox: PinMailbox;
}

function makeNode(pin: string, d: Directory, deps: Partial<PinMailboxDeps>, online: boolean): Node {
  const storage = new FakeStorage();
  storage.map.set("meta:pin", pin);
  const socket = new FakeSocket({ authenticated: true, pin });
  const ctx = {
    storage,
    getWebSockets: () => (online ? [socket] : []),
    acceptWebSocket: () => {},
  } as unknown as DurableObjectState;
  // The base class needs a real DurableObjectState; build over one, then swap in the fake ctx.
  const mailbox = new PinMailbox(realState!, env as never, { now: () => 1_000_000, directory: dirOf(d), ...deps });
  Object.defineProperty(mailbox, "ctx", { value: ctx, configurable: true });
  return { storage, socket, mailbox };
}

type Kind = "message" | "delivered" | "read" | "typing";
const caseArb = fc.record({
  kind: fc.constantFrom<Kind>("message", "delivered", "read", "typing"),
  // Each side's independent view of the pair. Directory outages are Property 21's scope.
  senderView: fc.boolean(),
  receiverView: fc.boolean(),
  online: fc.boolean(),
});

// Feature: pinme-burnable-pin-messenger, Property 20: Contacts-only relay gate
// **Validates: Requirements 7.3, 7.9, 8.7, 8.8, 9.7, 10.6, 16.1, 16.3, 16.4**
describe("Property 20: PinMailbox contacts-only relay gate", () => {
  beforeAll(async () => {
    realState = await runInDurableObject(env.PIN_MAILBOX.get(env.PIN_MAILBOX.newUniqueId()), (_i, state) => state);
  });

  it("relays iff both the sending and the receiving mailbox verify the accepted pair; otherwise drops, stores nothing, and errors where specified", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(caseArb, { minLength: 1, maxLength: 5 }), async (cases) => {
        let n = 0;
        for (const c of cases) {
          // Fresh nodes per case so the 5 s pair cache never leaks verdicts between cases.
          const senderDir: Directory = { accepted: c.senderView };
          const recvDir: Directory = { accepted: c.receiverView };
          const recipient = makeNode(RECIPIENT, recvDir, {}, c.online);
          const rpc = recipient.mailbox as unknown as MailboxRpc;
          const sender = makeNode(SENDER, senderDir, { mailbox: () => rpc }, true);
          const att = sender.socket.deserializeAttachment();
          const priv = sender.mailbox as unknown as {
            onMessage(ws: unknown, a: unknown, e: unknown): Promise<void>;
            onReceipt(a: unknown, k: string, to: string, id: string): Promise<void>;
            onTyping(ws: unknown, a: unknown, to: string): Promise<void>;
          };
          const messageId = uuid(++n);
          const recvStorageBefore = new Map(recipient.storage.map);

          if (c.kind === "message") {
            await priv.onMessage(sender.socket, att, { to: RECIPIENT, messageId, nonce: NONCE, ciphertext: "Y2lwaGVy" });
          } else if (c.kind === "typing") {
            await priv.onTyping(sender.socket, att, RECIPIENT);
          } else {
            await priv.onReceipt(att, c.kind, RECIPIENT, messageId);
          }

          const relayed = c.senderView === true && c.receiverView === true;
          const recvFrames = recipient.socket.sent;
          const errors = sender.socket.sent.filter((f) => f.type === "error");

          if (relayed) {
            expect(errors).toHaveLength(0);
            if (c.online) {
              expect(recvFrames).toHaveLength(1);
              expect(recvFrames[0]!.type).toBe(c.kind);
              expect(recvFrames[0]!.from).toBe(SENDER);
            } else {
              expect(recvFrames).toHaveLength(0);
              const stored = c.kind === "typing" ? 0 : 1;
              expect(recipient.storage.map.size - recvStorageBefore.size).toBe(stored);
            }
          } else {
            // Dropped: nothing delivered, nothing stored.
            expect(recvFrames).toHaveLength(0);
            expect(new Map(recipient.storage.map)).toEqual(recvStorageBefore);
            if (c.kind === "delivered" || c.kind === "read") {
              // Receipts to non-contacts are discarded silently (Req 8.7, 8.8).
              expect(errors).toHaveLength(0);
            } else {
              expect(errors).toHaveLength(1);
              expect(errors[0]!.code).toBe("not_a_contact");
              if (c.kind === "message") expect(errors[0]!.ref).toBe(messageId);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("receiving mailbox rejects non-contact RPC items on its own, regardless of the sender's claim", async () => {
    const recipient = makeNode(RECIPIENT, { accepted: false }, {}, true);
    const envelope = { to: RECIPIENT, messageId: uuid(1), nonce: NONCE, ciphertext: "Y2lwaGVy" };
    expect(await recipient.mailbox.deliver({ from: SENDER, envelope })).toEqual({ ok: false, error: "not_a_contact" });
    expect(await recipient.mailbox.deliverTyping({ from: SENDER })).toEqual({ ok: false, error: "not_a_contact" });
    expect(await recipient.mailbox.deliverReceipt({ from: SENDER, kind: "read", messageId: uuid(2) })).toEqual({ ok: false });
    expect(recipient.socket.sent).toHaveLength(0);
    expect([...recipient.storage.map.keys()]).toEqual(["meta:pin"]);
  });
});
