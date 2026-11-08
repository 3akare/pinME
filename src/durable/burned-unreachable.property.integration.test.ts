/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BURNED_KEY } from "./burn";
import { ENV_PREFIX } from "./outbox";

// Feature: pinme-burnable-pin-messenger, Property 30: Burned PIN is unreachable
// **Validates: Requirements 13.5, 13.11, 13.14**

const HEX = "0123456789ABCDEF".split("");
const pinArb = fc.array(fc.constantFrom(...HEX), { minLength: 8, maxLength: 8 }).map((a) => a.join(""));
const NONCE = "A".repeat(32);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const stubFor = (name: string) => env.PIN_MAILBOX.get(env.PIN_MAILBOX.idFromName(name));

describe("Property 30: burned PIN is unreachable (PinMailbox layer)", () => {
  it("after burn: storage holds only the tombstone, messages/typing are rejected with pin_burned, connections get pin_unavailable with no challenge", async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(
        pinArb,
        pinArb,
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 3 }),
        async (ownPin, sender, queued, extraBurns) => {
          // Unique DO per run so earlier runs cannot leak state.
          const name = `${ownPin}-p30-${++run}`;
          const stub = stubFor(name);

          // Seed queued envelopes (from a sender that is a contact) then burn.
          await runInDurableObject(stub, async (inst, state) => {
            await state.storage.put("meta:pin", ownPin);
            for (let i = 0; i < queued; i++) {
              await state.storage.put(`${ENV_PREFIX}${i}`, { from: sender, messageId: uuid(i) });
            }
            for (let i = 0; i < extraBurns; i++) await inst.burn(); // idempotent
          });

          const after = await runInDurableObject(stub, async (inst, state) => {
            const keys = [...(await state.storage.list()).keys()];
            const msg = await inst.deliver({
              from: sender,
              envelope: { to: ownPin, messageId: uuid(99), nonce: NONCE, ciphertext: "Y2lwaGVy" },
            });
            const typing = await inst.deliverTyping({ from: sender });
            const ping = await inst.deliverPing({ from: sender });
            return { keys, msg, typing, ping };
          });
          expect(after.keys).toEqual([BURNED_KEY]);
          expect(after.msg).toEqual({ ok: false, error: "pin_burned" });
          expect(after.typing).toEqual({ ok: false, error: "pin_burned" });
          expect(after.ping).toEqual({ ok: false, error: "pin_burned" });
        },
      ),
      { numRuns: 20 },
    );
  });

  it("a connection to a burned mailbox gets pin_unavailable and no challenge", async () => {
    const pin = "0BADF00D";
    const stub = env.PIN_MAILBOX.get(env.PIN_MAILBOX.idFromName(pin));
    await runInDurableObject(stub, (inst) => inst.burn());

    const res = await exports.default.fetch(`https://example.com/ws/${pin}`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const frames: Record<string, unknown>[] = [];
    ws.addEventListener("message", (e) => frames.push(JSON.parse(e.data as string)));
    const closed = new Promise<void>((r) => ws.addEventListener("close", () => r()));
    ws.accept();
    await closed;
    expect(frames).toEqual([{ type: "error", code: "pin_unavailable" }]);
  });
});
