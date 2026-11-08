import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "../state/connection";
import { createDispatcher } from "./dispatch";
import { createConnectionManager } from "./manager";
import { startSession } from "./session";

const A = "AAAAAAAA";
const B = "BBBBBBBB";

describe("connection manager teardown", () => {
  const fakeSession = () => ({
    dispatcher: createDispatcher(),
    send: () => true,
    close: vi.fn<() => void>(),
  });

  it("runs the setup teardown before closing, on remove and on sync", () => {
    const order: string[] = [];
    const sessions = new Map<string, ReturnType<typeof fakeSession>>();
    const m = createConnectionManager({
      urlFor: (p) => `ws://x/ws/${p}`,
      start: (o) => {
        const s = fakeSession();
        s.close.mockImplementation(() => order.push(`close:${o.pin}`));
        sessions.set(o.pin, s);
        return s;
      },
      setup: (pin) => () => order.push(`teardown:${pin}`),
    });
    m.sync([{ pin: A, signSk: new Uint8Array(64) }, { pin: B, signSk: new Uint8Array(64) }]);
    m.remove(A);
    m.sync([]);
    expect(order).toEqual([`teardown:${A}`, `close:${A}`, `teardown:${B}`, `close:${B}`]);
    expect(m.pins()).toEqual([]);
  });

  it("wires each session exactly once", () => {
    const setup = vi.fn();
    const m = createConnectionManager({ urlFor: () => "ws://x", start: fakeSession, setup });
    const pin = { pin: A, signSk: new Uint8Array(64) };
    m.add(pin);
    m.add(pin);
    m.sync([pin]);
    expect(setup).toHaveBeenCalledTimes(1);
  });
});

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}

describe("per-PIN connection status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    useConnectionStore.getState().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("one PIN dropping does not change another PIN's status, and close forgets it", () => {
    const opts = { signSk: new Uint8Array(64), socket: { env: null } };
    const a = startSession({ pin: A, url: "ws://x/ws/A", ...opts });
    const b = startSession({ pin: B, url: "ws://x/ws/B", ...opts });
    const status = () => useConnectionStore.getState().byPin;
    expect(status()).toEqual({ [A]: "connecting", [B]: "connecting" });
    FakeWebSocket.instances[1]!.onclose?.();
    expect(status()).toEqual({ [A]: "connecting", [B]: "disconnected" });
    a.close();
    expect(status()).toEqual({ [B]: "disconnected" });
    // A late close from the already-closed session must not resurrect its entry.
    FakeWebSocket.instances[0]!.onclose?.();
    expect(status()[A]).toBeUndefined();
    b.close();
  });
});
