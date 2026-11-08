import { describe, expect, it, vi } from "vitest";
import { createDispatcher } from "../net/dispatch";
import {
  createTypingThrottle,
  createTypingVisibility,
  registerTypingHandlers,
  type TypingTimers,
} from "./typing";

function fakeTimers() {
  let t = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const timers: TypingTimers = {
    now: () => t,
    setTimeout: (fn, ms) => {
      jobs.set(++id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (h) => void jobs.delete(h as number),
  };
  return {
    timers,
    advance(ms: number) {
      t += ms;
      for (const [k, j] of [...jobs]) if (j.at <= t) (jobs.delete(k), j.fn());
    },
  };
}

describe("typing throttle", () => {
  it("sends at most once per 3 s and stops on empty input", () => {
    const th = createTypingThrottle();
    expect(th.onInput("k", "a", 0)).toBe(true);
    expect(th.onInput("k", "ab", 2999)).toBe(false);
    expect(th.onInput("k", "abc", 3000)).toBe(true);
    expect(th.onInput("k", "", 3100)).toBe(false);
    expect(th.onInput("k", "x", 3200)).toBe(true);
  });
  it("is independent per conversation and resets on stop", () => {
    const th = createTypingThrottle();
    expect(th.onInput("a", "x", 0)).toBe(true);
    expect(th.onInput("b", "x", 1)).toBe(true);
    th.stop("a");
    expect(th.onInput("a", "x", 2)).toBe(true);
  });
});

describe("typing visibility", () => {
  it("shows, hides after 5 s, and restarts on new frames", () => {
    const f = fakeTimers();
    const set = vi.fn();
    const v = createTypingVisibility(set, f.timers);
    v.onTyping("k");
    expect(set).toHaveBeenLastCalledWith("k", true);
    f.advance(4000);
    v.onTyping("k");
    f.advance(4999);
    expect(set).toHaveBeenLastCalledWith("k", true);
    f.advance(1);
    expect(set).toHaveBeenLastCalledWith("k", false);
  });
  it("hides on message arrival and cancels the timer", () => {
    const f = fakeTimers();
    const set = vi.fn();
    const v = createTypingVisibility(set, f.timers);
    v.onTyping("k");
    v.onMessage("k");
    expect(set).toHaveBeenLastCalledWith("k", false);
    const calls = set.mock.calls.length;
    f.advance(6000);
    expect(set.mock.calls.length).toBe(calls);
  });
});

describe("registerTypingHandlers", () => {
  const frame = (from: string) => JSON.stringify({ type: "typing", from });
  function setup(opts: { contact?: boolean; open?: boolean } = {}) {
    const f = fakeTimers();
    const set = vi.fn();
    let incoming: (pin: string) => void = () => {};
    const d = createDispatcher();
    registerTypingHandlers(d, {
      ownPin: "AAAAAAAA",
      isContact: () => opts.contact ?? true,
      isOpen: () => opts.open ?? true,
      setVisible: set,
      subscribeIncoming: (l) => ((incoming = l), () => {}),
      timers: f.timers,
    });
    return { d, set, f, incoming: (p: string) => incoming(p) };
  }
  it("shows for an accepted contact with open conversation, hides on message", () => {
    const s = setup();
    s.d.dispatch(frame("BBBBBBBB"));
    expect(s.set).toHaveBeenLastCalledWith("AAAAAAAA:BBBBBBBB", true);
    s.incoming("BBBBBBBB");
    expect(s.set).toHaveBeenLastCalledWith("AAAAAAAA:BBBBBBBB", false);
  });
  it("ignores non-contacts and closed conversations", () => {
    const a = setup({ contact: false });
    a.d.dispatch(frame("BBBBBBBB"));
    expect(a.set).not.toHaveBeenCalled();
    const b = setup({ open: false });
    b.d.dispatch(frame("BBBBBBBB"));
    expect(b.set).not.toHaveBeenCalled();
  });
});
