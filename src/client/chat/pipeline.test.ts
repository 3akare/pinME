import { beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, generatePinKeys, ready } from "../crypto";
import { createDispatcher } from "../net/dispatch";
import { registerMessageHandlers } from "../net/handlers/message";
import { useChatStore } from "../state/chat";
import type { ContactRecord, MessageRecord, PinRecord } from "../storage";
import { receiveMessage, type ReceiveDeps } from "./receive";
import { sendMessage, type SendDeps } from "./send";

const A = "AAAAAAAA", B = "BBBBBBBB";
let ka: ReturnType<typeof generatePinKeys>, kb: ReturnType<typeof generatePinKeys>;
beforeAll(async () => {
  await ready();
  ka = generatePinKeys();
  kb = generatePinKeys();
});

function repos(own: string, ownKeys: typeof ka, other: string, otherKeys: typeof ka) {
  const msgs = new Map<string, MessageRecord>();
  const put = vi.fn(async (m: MessageRecord) => void msgs.set(m.messageId, m));
  return {
    msgs,
    put,
    repos: {
      pinRepo: { get: async () => ({ pin: own, boxSk: ownKeys.box.privateKey, boxPk: ownKeys.box.publicKey }) as PinRecord },
      contactRepo: {
        get: async (_o: string, c: string) =>
          c === other ? ({ boxPk: otherKeys.box.publicKey, unavailable: false } as ContactRecord) : undefined,
      },
      messageRepo: { get: async (_o: string, _c: string, id: string) => msgs.get(id), put },
    } as never,
  };
}

describe("send/receive pipeline", () => {
  it("round-trips and records with clock marker", async () => {
    const s = repos(A, ka, B, kb);
    const r = repos(B, kb, A, ka);
    const frames: string[] = [];
    const sink = { addMessage: vi.fn() };
    const sendDeps: SendDeps = { repos: s.repos, store: sink, encrypt, send: (d) => (frames.push(d), true), isConnected: () => true };
    const res = await sendMessage(sendDeps, { ownPin: A, contactPin: B, text: "hi" });
    expect(res.ok && res.message.marker).toBe("clock");
    expect(s.msgs.size).toBe(1);
    const frame = JSON.parse(frames[0]!);
    expect(frame.type).toBe("message");
    const onSaved = vi.fn();
    const rsink = { addMessage: vi.fn() };
    const got = await receiveMessage({ repos: r.repos, store: rsink, decrypt, onSaved } as ReceiveDeps, B, { from: A, envelope: frame.envelope });
    expect(got?.text).toBe("hi");
    expect(onSaved).toHaveBeenCalledOnce();
    expect(rsink.addMessage).toHaveBeenCalledOnce();
  });

  it("does nothing while disconnected", async () => {
    const s = repos(A, ka, B, kb);
    const send = vi.fn(() => true);
    const res = await sendMessage({ repos: s.repos, store: { addMessage: vi.fn() }, encrypt, send, isConnected: () => false }, { ownPin: A, contactPin: B, text: "x" });
    expect(res).toEqual({ ok: false, code: "disconnected" });
    expect(send).not.toHaveBeenCalled();
    expect(s.msgs.size).toBe(0);
  });

  it("rejects empty and over-long text", async () => {
    const s = repos(A, ka, B, kb);
    const d: SendDeps = { repos: s.repos, store: { addMessage: vi.fn() }, encrypt, send: () => true, isConnected: () => true };
    expect((await sendMessage(d, { ownPin: A, contactPin: B, text: "" })).ok).toBe(false);
    expect((await sendMessage(d, { ownPin: A, contactPin: B, text: "a".repeat(4097) })).ok).toBe(false);
    expect((await sendMessage(d, { ownPin: A, contactPin: B, text: "a".repeat(4096) })).ok).toBe(true);
  });

  it("discards tampered ciphertext silently with no trace", async () => {
    const s = repos(A, ka, B, kb);
    const r = repos(B, kb, A, ka);
    const frames: string[] = [];
    await sendMessage({ repos: s.repos, store: { addMessage: vi.fn() }, encrypt, send: (d) => (frames.push(d), true), isConnected: () => true }, { ownPin: A, contactPin: B, text: "hello" });
    const env = JSON.parse(frames[0]!).envelope;
    const bad = env.ciphertext.startsWith("A") ? "B" + env.ciphertext.slice(1) : "A" + env.ciphertext.slice(1);
    const rsink = { addMessage: vi.fn() };
    const got = await receiveMessage({ repos: r.repos, store: rsink, decrypt }, B, { from: A, envelope: { ...env, ciphertext: bad } });
    expect(got).toBeNull();
    expect(r.put).not.toHaveBeenCalled();
    expect(rsink.addMessage).not.toHaveBeenCalled();
  });

  it("registerMessageHandlers only registers 'message'", async () => {
    const d = createDispatcher();
    const typing = vi.fn();
    d.register("typing", typing);
    const r = repos(B, kb, A, ka);
    registerMessageHandlers(d, { ownPin: B, repos: r.repos, store: useChatStore.getState(), decrypt });
    d.dispatch(JSON.stringify({ type: "typing", from: A }));
    expect(typing).toHaveBeenCalled();
  });

  it("store applies markers monotonically", () => {
    const st = useChatStore.getState();
    st.reset();
    st.addMessage({ ownPin: A, contactPin: B, messageId: "m1", direction: "out", text: "t", ts: 1, marker: "clock", kind: "chat" });
    st.applyMarker(A, B, "m1", "R");
    st.applyMarker(A, B, "m1", "D");
    expect(useChatStore.getState().messages[`${A}:${B}`]![0]!.marker).toBe("R");
  });
});
