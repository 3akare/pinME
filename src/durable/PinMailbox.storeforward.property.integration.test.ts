/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ENV_PREFIX, type OutboxStorage } from "./outbox";
import { PinMailbox, type PinMailboxDeps } from "./PinMailbox";

const OWN_PIN = "AAAAAAAA";
const PEERS = ["BBBBBBBB", "CCCCCCCC", "DDDDDDDD"];
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

type Op =
  | { kind: "send"; peer: number }
  | { kind: "typing"; peer: number }
  | { kind: "auth" }
  | { kind: "unauthConnect" }
  | { kind: "dropAll" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("send" as const), peer: fc.nat(PEERS.length - 1) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("typing" as const), peer: fc.nat(PEERS.length - 1) }) },
  { weight: 2, arbitrary: fc.constant({ kind: "auth" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "unauthConnect" as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: "dropAll" as const }) },
);

async function makeMailbox() {
  // The base class needs a real DurableObjectState; build over one, then swap in a fake ctx.
  const real = await runInDurableObject(env.PIN_MAILBOX.get(env.PIN_MAILBOX.newUniqueId()), (_i, state) => state);
  const storage = new FakeStorage();
  storage.map.set("meta:pin", OWN_PIN);
  let sockets: FakeSocket[] = [];
  const ctx = {
    storage,
    getWebSockets: () => sockets,
    acceptWebSocket: () => {},
  } as unknown as DurableObjectState;
  const deps: Partial<PinMailboxDeps> = {
    now: () => 1_000_000,
    directory: () => ({ isContactPair: async () => true, lookupPin: async () => ({ state: "active" }) }) as never,
  };
  const mailbox = new PinMailbox(real, env as never, deps);
  Object.defineProperty(mailbox, "ctx", { value: ctx, configurable: true });
  return {
    storage,
    mailbox,
    get sockets() {
      return sockets;
    },
    set sockets(s: FakeSocket[]) {
      sockets = s;
    },
  };
}

// Feature: pinme-burnable-pin-messenger, Property 19: Mailbox store-and-forward
// **Validates: Requirements 7.4, 7.5, 7.6, 9.8, 10.7, 17.5**
describe("Property 19: PinMailbox store-and-forward", () => {
  it("delivers to all authenticated sockets, else stores; stored items are delivered once then deleted; typing is never stored", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 30 }), async (ops) => {
        const h = await makeMailbox();
        const queue: { from: string; messageId: string }[] = [];
        let counter = 0;

        for (const op of ops) {
          const authed = h.sockets.filter((s) => (s.deserializeAttachment() as { authenticated: boolean }).authenticated);
          if (op.kind === "send") {
            const from = PEERS[op.peer]!;
            const messageId = uuid(++counter);
            const before = authed.map((s) => s.sent.length);
            const res = await h.mailbox.deliver({
              from,
              envelope: { to: OWN_PIN, messageId, nonce: NONCE, ciphertext: "Y2lwaGVy" },
            });
            expect(res).toEqual({ ok: true, stored: authed.length === 0 });
            authed.forEach((s, i) => {
              expect(s.sent).toHaveLength(before[i]! + 1);
              const f = s.sent[s.sent.length - 1]!;
              expect(f.type).toBe("message");
              expect(f.from).toBe(from);
              expect((f.envelope as { messageId: string }).messageId).toBe(messageId);
            });
            if (authed.length === 0) queue.push({ from, messageId });
          } else if (op.kind === "typing") {
            const counts = authed.map((s) => s.sent.length);
            const before = new Map(h.storage.map);
            const res = await h.mailbox.deliverTyping({ from: PEERS[op.peer]! });
            expect(res).toEqual({ ok: true, delivered: authed.length > 0 });
            authed.forEach((s, i) => expect(s.sent).toHaveLength(counts[i]! + 1));
            expect(new Map(h.storage.map)).toEqual(before); // nothing stored
          } else if (op.kind === "auth") {
            const ws = new FakeSocket({ authenticated: true, pin: OWN_PIN });
            h.sockets = [...h.sockets, ws];
            await (h.mailbox as unknown as { flushStoredEnvelopes(w: unknown): Promise<void> }).flushStoredEnvelopes(ws);
            // Exactly the stored queue, in order, once.
            expect(ws.sent.map((f) => (f.envelope as { messageId: string }).messageId)).toEqual(
              queue.map((q) => q.messageId),
            );
            expect(ws.sent.map((f) => f.from)).toEqual(queue.map((q) => q.from));
            queue.length = 0;
          } else if (op.kind === "unauthConnect") {
            const ws = new FakeSocket({ authenticated: false, pin: OWN_PIN });
            h.sockets = [...h.sockets, ws];
          } else {
            h.sockets = [];
          }

          // Storage holds exactly the pending queue; nothing else is envelope-keyed.
          const keys = [...h.storage.map.keys()].filter((k) => k.startsWith(ENV_PREFIX));
          expect(keys).toHaveLength(queue.length);
          for (const k of h.storage.map.keys()) expect(k.startsWith("rcpt:")).toBe(false);
        }

        // Unauthenticated sockets never received anything.
        for (const s of h.sockets) {
          if (!(s.deserializeAttachment() as { authenticated: boolean }).authenticated) expect(s.sent).toHaveLength(0);
        }
      }),
      { numRuns: 50 },
    );
  });
});
