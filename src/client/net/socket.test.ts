import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectSocket, type SocketEnvironment } from "./socket";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }
  // Test drivers.
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  receive(data: string) {
    this.onmessage?.({ data });
  }
  serverClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

function fakeEnv() {
  const listeners = new Map<string, () => void>();
  let visible: (() => void) | null = null;
  const env: SocketEnvironment = {
    addEventListener: (type, fn) => void listeners.set(type, fn),
    removeEventListener: (type) => void listeners.delete(type),
    onVisible(fn) {
      visible = fn;
      return () => {
        visible = null;
      };
    },
  };
  return {
    env,
    fire: (type: "online" | "offline") => listeners.get(type)?.(),
    becomeVisible: () => visible?.(),
    listenerCount: () => listeners.size + (visible ? 1 : 0),
  };
}

const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
const HB = { request: "hb", response: "hb-ack", intervalMs: 1000, timeoutMs: 500 };

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connectSocket", () => {
  it("never hands heartbeat replies to the frame handler", () => {
    const onMessage = vi.fn();
    connectSocket({ url: "ws://x", onMessage, heartbeat: HB, env: null });
    latest().open();
    latest().receive("hb-ack");
    latest().receive('{"type":"ping","from":"AAAAAAAA"}');
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("probes an idle socket and drops it when the probe goes unanswered", () => {
    const onClose = vi.fn();
    connectSocket({ url: "ws://x", onClose, heartbeat: HB, env: null, random: () => 0 });
    const first = latest();
    first.open();
    vi.advanceTimersByTime(1000);
    expect(first.sent).toEqual(["hb"]);
    vi.advanceTimersByTime(500);
    expect(first.closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); // first backoff step
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("keeps a socket that answers its probes", () => {
    connectSocket({ url: "ws://x", heartbeat: HB, env: null });
    const s = latest();
    s.open();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1000);
      s.receive("hb-ack");
    }
    vi.advanceTimersByTime(400);
    expect(s.closed).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("ignores events from a socket it already dropped", () => {
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const e = fakeEnv();
    connectSocket({ url: "ws://x", onMessage, onClose, env: e.env, random: () => 0 });
    const old = latest();
    old.open();
    e.fire("offline");
    old.receive('{"type":"ping","from":"AAAAAAAA"}');
    old.serverClose();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reconnects at once when the browser comes back online", () => {
    const e = fakeEnv();
    connectSocket({ url: "ws://x", env: e.env, random: () => 0 });
    latest().serverClose();
    latest(); // still the closed one; a 1 s retry is pending
    e.fire("online");
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.instances).toHaveLength(2); // the pending retry was cancelled
  });

  it("verifies an open socket when the tab becomes visible again", () => {
    const e = fakeEnv();
    connectSocket({ url: "ws://x", heartbeat: HB, env: e.env });
    latest().open();
    e.becomeVisible();
    expect(latest().sent).toEqual(["hb"]);
  });

  it("spreads reconnect delays with jitter but never shortens them", () => {
    connectSocket({ url: "ws://x", env: null, random: () => 0.999 });
    latest().serverClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(250);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("close() stops reconnecting and removes every listener", () => {
    const e = fakeEnv();
    const onClose = vi.fn();
    const sock = connectSocket({ url: "ws://x", onClose, heartbeat: HB, env: e.env });
    latest().open();
    expect(e.listenerCount()).toBe(3);
    sock.close();
    expect(e.listenerCount()).toBe(0);
    latest().serverClose();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(sock.send("x")).toBe(false);
  });
});
