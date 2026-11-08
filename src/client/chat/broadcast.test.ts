import { describe, expect, it } from "vitest";
import { sendBroadcast, type BroadcastDeps } from "./broadcast";
import type { ContactRecord, MessageRecord } from "../storage";

const OWN = "AAAAAAAA";
function contact(pin: string, extra: Partial<ContactRecord> = {}): ContactRecord {
  return {
    ownPin: OWN,
    contactPin: pin,
    displayName: pin,
    boxPk: new Uint8Array(32),
    signPk: new Uint8Array(32),
    status: "active",
    personalMessage: "",
    unavailable: false,
    ...extra,
  };
}

function setup(contacts: ContactRecord[], connected = true) {
  const frames: any[] = [];
  const stored: MessageRecord[] = [];
  const added: MessageRecord[] = [];
  let n = 0;
  const deps: BroadcastDeps = {
    repos: {
      pinRepo: { get: async () => ({ pin: OWN, boxSk: new Uint8Array(32) }) },
      contactRepo: { listForPin: async () => contacts },
      messageRepo: { put: async (m: MessageRecord) => void stored.push(m) },
    } as any,
    store: { addMessage: (m) => void added.push(m) },
    encrypt: () => {
      const nonce = new Uint8Array(24);
      nonce[0] = ++n % 256;
      nonce[1] = Math.floor(n / 256);
      return { nonce, ciphertext: new Uint8Array([1, 2, 3]) };
    },
    send: (d) => (frames.push(JSON.parse(d)), true),
    isConnected: () => connected,
    newMessageId: () => `id-${n}-${frames.length}-${Math.random()}`,
  };
  return { deps, frames, stored, added };
}

describe("sendBroadcast", () => {
  it("builds one envelope per contact with distinct ids and nonces", async () => {
    const { deps, frames, stored } = setup([contact("BBBBBBBB"), contact("CCCCCCCC")]);
    const r = await sendBroadcast(deps, { ownPin: OWN, text: "hi" });
    expect(r.ok).toBe(true);
    expect(frames).toHaveLength(1);
    const env = frames[0].envelopes;
    expect(frames[0].type).toBe("broadcast");
    expect(env.map((e: any) => e.to)).toEqual(["BBBBBBBB", "CCCCCCCC"]);
    expect(new Set(env.map((e: any) => e.messageId)).size).toBe(2);
    expect(new Set(env.map((e: any) => e.nonce)).size).toBe(2);
    expect(stored.every((m) => m.marker === "clock" && m.kind === "broadcast")).toBe(true);
  });

  it("chunks into frames of at most 100 envelopes", async () => {
    const cs = Array.from({ length: 250 }, (_, i) => contact(`P${String(i).padStart(7, "0")}`));
    const { deps, frames } = setup(cs);
    await sendBroadcast(deps, { ownPin: OWN, text: "hi" });
    expect(frames.map((f) => f.envelopes.length)).toEqual([100, 100, 50]);
  });

  it("errors with no recipients and sends nothing", async () => {
    const { deps, frames } = setup([contact("BBBBBBBB", { unavailable: true })]);
    expect(await sendBroadcast(deps, { ownPin: OWN, text: "hi" })).toEqual({
      ok: false,
      code: "no_recipients",
    });
    expect(frames).toHaveLength(0);
  });

  it("is disabled while disconnected", async () => {
    const { deps, frames } = setup([contact("BBBBBBBB")], false);
    const r = await sendBroadcast(deps, { ownPin: OWN, text: "hi" });
    expect(r).toEqual({ ok: false, code: "disconnected" });
    expect(frames).toHaveLength(0);
  });
});
