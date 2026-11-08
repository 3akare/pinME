import { describe, expect, it } from "vitest";
import { createDispatcher } from "../net/dispatch";
import { registerReceiptHandlers } from "../net/handlers/receipts";
import type { MessageRecord } from "../storage";
import { createReceiptSender } from "./receipts";

const A = "AAAAAAAA";
const B = "BBBBBBBB";
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

const inMsg = (id = ID1): MessageRecord => ({
  ownPin: A, contactPin: B, messageId: id, direction: "in", text: "hi", ts: 1, kind: "chat",
});

describe("receipt sender", () => {
  it("sends delivered on save and read once when visible", () => {
    const sent: any[] = [];
    const s = createReceiptSender({ send: (d) => (sent.push(JSON.parse(d)), true), isChatVisible: () => true });
    s.onSaved(inMsg());
    s.onChatVisible(A, B);
    expect(sent).toEqual([
      { type: "delivered", to: B, messageId: ID1 },
      { type: "read", to: B, messageId: ID1 },
    ]);
  });

  it("defers read until the chat is visible, then sends exactly one", () => {
    const sent: any[] = [];
    let visible = false;
    const s = createReceiptSender({ send: (d) => (sent.push(JSON.parse(d)), true), isChatVisible: () => visible });
    s.onSaved(inMsg());
    expect(sent.map((f) => f.type)).toEqual(["delivered"]);
    visible = true;
    s.onChatVisible(A, B);
    s.onChatVisible(A, B);
    expect(sent.map((f) => f.type)).toEqual(["delivered", "read"]);
  });

  it("retries while disconnected until the 5 s deadline", () => {
    let t = 0;
    let ok = false;
    const calls: number[] = [];
    const timers: (() => void)[] = [];
    const s = createReceiptSender({
      send: () => (calls.push(t), ok),
      isChatVisible: () => false,
      now: () => t,
      schedule: (fn) => void timers.push(fn),
    });
    s.onSaved(inMsg());
    t = 1000; ok = true;
    timers.shift()!();
    expect(calls).toEqual([0, 1000]);
    expect(timers).toHaveLength(0);
  });

  it("stops retrying after the deadline", () => {
    let t = 0;
    const timers: (() => void)[] = [];
    const s = createReceiptSender({ send: () => false, isChatVisible: () => false, now: () => t, schedule: (f) => void timers.push(f) });
    s.onSaved(inMsg());
    for (let i = 0; i < 10 && timers.length; i++) { t += 1000; timers.shift()!(); }
    expect(timers).toHaveLength(0);
    expect(t).toBeLessThanOrEqual(5000);
  });
});

describe("receipt handlers", () => {
  function setup(initial: "clock" | "D" | "R" | undefined = "clock") {
    const rec: MessageRecord = {
      ownPin: A, contactPin: B, messageId: ID1, direction: "out", text: "x", ts: 1, kind: "chat", marker: initial,
    };
    const db = new Map([[ID1, rec]]);
    const applied: string[] = [];
    const persisted: string[] = [];
    const dispatcher = createDispatcher({}, () => {});
    registerReceiptHandlers(dispatcher, {
      ownPin: A,
      repos: {
        messageRepo: {
          get: async (_o: string, _c: string, id: string) => db.get(id),
          setMarker: async (_o: string, _c: string, id: string, m: any) => {
            persisted.push(m);
            db.set(id, { ...db.get(id)!, marker: m });
          },
        } as any,
      },
      store: { applyMarker: (_o, _c, _id, m) => void applied.push(m) },
    });
    return { dispatcher, applied, persisted };
  }
  const frame = (type: string, id = ID1) => JSON.stringify({ type, from: B, messageId: id });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("read jumps clock -> R and persists", async () => {
    const t = setup();
    t.dispatcher.dispatch(frame("read"));
    await flush();
    expect(t.applied).toEqual(["R"]);
    expect(t.persisted).toEqual(["R"]);
  });

  it("never moves backward (late delivered after R)", async () => {
    const t = setup("R");
    t.dispatcher.dispatch(frame("delivered"));
    await flush();
    expect(t.persisted).toEqual([]);
    expect(t.applied.every((m) => m === "R")).toBe(true);
  });

  it("ignores unknown Message_IDs", async () => {
    const t = setup();
    t.dispatcher.dispatch(frame("delivered", ID2));
    await flush();
    expect(t.applied).toEqual([]);
    expect(t.persisted).toEqual([]);
  });

  it("delivered advances clock -> D", async () => {
    const t = setup();
    t.dispatcher.dispatch(frame("delivered"));
    await flush();
    expect(t.persisted).toEqual(["D"]);
  });
});
