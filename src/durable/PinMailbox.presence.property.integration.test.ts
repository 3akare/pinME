/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { OutboxStorage } from "./outbox";
import { PinMailbox, type PinMailboxDeps } from "./PinMailbox";
import { flushPresence, PRESENCE_PREFIX, presenceKey, type PresenceNotice } from "./presence";

const OWN_PIN = "AAAAAAAA";
const PEERS = ["BBBBBBBB", "CCCCCCCC", "DDDDDDDD"];

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
  | { kind: "push"; peer: number; status: "available" | "busy"; msg: string }
  | { kind: "auth" }
  | { kind: "unauthConnect" }
  | { kind: "dropAll" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant("push" as const),
      peer: fc.nat(PEERS.length - 1),
      status: fc.constantFrom("available" as const, "busy" as const),
      msg: fc.string({ maxLength: 20 }),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ kind: "auth" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "unauthConnect" as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: "dropAll" as const }) },
);

async function makeMailbox() {
  const real = await runInDurableObject(env.PIN_MAILBOX.get(env.PIN_MAILBOX.newUniqueId()), (_i, state) => state);
  const storage = new FakeStorage();
  storage.map.set("meta:pin", OWN_PIN);
  let sockets: FakeSocket[] = [];
  const ctx = {
    storage,
    getWebSockets: () => sockets,
    acceptWebSocket: () => {},
  } as unknown as DurableObjectState;
  const deps: Partial<PinMailboxDeps> = { now: () => 1_000_000 };
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

// Feature: pinme-burnable-pin-messenger, Property 25: Presence retention
// **Validates: Requirements 11.6, 11.7**
describe("Property 25: PinMailbox presence retention", () => {
  it("retains only the latest presence per sender while offline, delivers it after next authentication, and pushes immediately when authenticated", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 30 }), async (ops) => {
        const h = await makeMailbox();
        const expected = new Map<string, PresenceNotice>(); // latest retained per sender

        for (const op of ops) {
          const authed = h.sockets.filter((s) => (s.deserializeAttachment() as { authenticated: boolean }).authenticated);
          if (op.kind === "push") {
            const notice: PresenceNotice = {
              type: "inviteNotice",
              kind: "presence",
              from: PEERS[op.peer]!,
              status: op.status,
              personalMessage: op.msg,
            };
            const before = authed.map((s) => s.sent.length);
            const res = await h.mailbox.pushPresence(notice);
            expect(res).toEqual({ delivered: authed.length > 0 });
            if (authed.length > 0) {
              // Immediate delivery to every authenticated socket; nothing retained for this sender.
              authed.forEach((s, i) => {
                expect(s.sent).toHaveLength(before[i]! + 1);
                expect(s.sent[s.sent.length - 1]).toEqual(notice);
              });
              expected.delete(notice.from);
            } else {
              expected.set(notice.from, notice);
            }
          } else if (op.kind === "auth") {
            const ws = new FakeSocket({ authenticated: true, pin: OWN_PIN });
            h.sockets = [...h.sockets, ws];
            // Same call the authentication handler makes after a successful handshake.
            await flushPresence(h.storage, (n) => ws.send(JSON.stringify(n)));
            const want = [...expected.values()].sort((a, b) => (a.from < b.from ? -1 : 1));
            expect(ws.sent).toEqual(want); // exactly the latest per sender, once
            expected.clear();
          } else if (op.kind === "unauthConnect") {
            h.sockets = [...h.sockets, new FakeSocket({ authenticated: false, pin: OWN_PIN })];
          } else {
            h.sockets = [];
          }

          // Storage holds exactly the latest retained presence per sender.
          const keys = [...h.storage.map.keys()].filter((k) => k.startsWith(PRESENCE_PREFIX)).sort();
          expect(keys).toEqual([...expected.keys()].map(presenceKey).sort());
          for (const [from, n] of expected) expect(h.storage.map.get(presenceKey(from))).toEqual(n);
        }

        for (const s of h.sockets) {
          if (!(s.deserializeAttachment() as { authenticated: boolean }).authenticated) expect(s.sent).toHaveLength(0);
        }
      }),
      { numRuns: 50 },
    );
  });
});
