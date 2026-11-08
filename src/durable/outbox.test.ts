import { describe, expect, it } from "vitest";
import {
  DELETE_RETRY_INTERVAL_MS,
  ENVELOPE_TTL_MS,
  envelopeKey,
  flushOutbox,
  runOutboxMaintenance,
  storeEnvelope,
  type OutboxStorage,
  type StoredEnvelope,
} from "./outbox";

class FakeStorage implements OutboxStorage {
  map = new Map<string, unknown>();
  failDeletes = false;
  async get<T>(k: string) {
    return this.map.get(k) as T | undefined;
  }
  async put<T>(k: string, v: T) {
    this.map.set(k, v);
  }
  async delete(k: string) {
    if (this.failDeletes) throw new Error("fail");
    return this.map.delete(k);
  }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map([...this.map].filter(([k]) => k.startsWith(prefix))) as Map<string, T>;
  }
}

const rec = (storedAt: number, n = 1): StoredEnvelope => ({
  from: "ABCDEF",
  storedAt,
  envelope: { to: "GHJKLM", messageId: `00000000-0000-4000-8000-00000000000${n}`, nonce: "n", ciphertext: "c" },
});

describe("outbox", () => {
  it("keys sort by timestamp", () => {
    expect(envelopeKey(9, "a") < envelopeKey(10, "a")).toBe(true);
  });

  it("flush sends then deletes", async () => {
    const st = new FakeStorage();
    await storeEnvelope(st, rec(1000));
    const sent: string[] = [];
    const out = await flushOutbox(st, (_f, e) => sent.push(e.messageId), 2000);
    expect(out.sent).toBe(1);
    expect(st.map.size).toBe(0);
  });

  it("failed delete keeps record flagged, retries 3 times, never re-sends", async () => {
    const st = new FakeStorage();
    await storeEnvelope(st, rec(1000));
    st.failDeletes = true;
    const sent: string[] = [];
    const send = (_f: string, e: { messageId: string }) => sent.push(e.messageId);
    const out = await flushOutbox(st, send, 2000);
    expect(out.wake).toBe(2000 + DELETE_RETRY_INTERVAL_MS);
    await flushOutbox(st, send, 2001);
    expect(sent).toHaveLength(1);
    let now = out.wake!;
    let wake: number | null = now;
    for (let i = 0; i < 3; i++) {
      wake = await runOutboxMaintenance(st, now);
      now += DELETE_RETRY_INTERVAL_MS;
    }
    const [r] = [...st.map.values()] as StoredEnvelope[];
    expect(r.deleteRetries).toBe(3);
    expect(r.nextDeleteAt).toBeUndefined();
    expect(wake).toBe(1000 + ENVELOPE_TTL_MS + 1);
  });

  it("purges envelopes older than 30 days", async () => {
    const st = new FakeStorage();
    await storeEnvelope(st, rec(0, 1));
    await storeEnvelope(st, rec(ENVELOPE_TTL_MS, 2));
    const wake = await runOutboxMaintenance(st, ENVELOPE_TTL_MS + 2);
    expect(st.map.size).toBe(1);
    expect(wake).toBe(2 * ENVELOPE_TTL_MS + 1);
  });
});
