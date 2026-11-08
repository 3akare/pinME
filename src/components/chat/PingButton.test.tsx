// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDispatcher } from "../../client/net/dispatch";
import { SHAKE_MS, VIBRATE_MS, playPingSound, registerPingHandlers } from "../../client/net/handlers/ping";
import { PingButton } from "./PingButton";

const ME = "AAAAAAAA";
const PEER = "BBBBBBBB";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PingButton", () => {
  const setup = () => {
    const dispatcher = createDispatcher({}, () => {});
    const send = vi.fn();
    render(<PingButton to={PEER} send={send} dispatcher={dispatcher} />);
    const btn = () => screen.getByRole("button", { name: "Send PING" }) as HTMLButtonElement;
    return { dispatcher, send, btn };
  };

  it("sends a ping frame immediately on press (within 1 s)", () => {
    const { send, btn } = setup();
    const t0 = Date.now();
    fireEvent.click(btn());
    expect(Date.now() - t0).toBeLessThanOrEqual(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0]![0])).toEqual({ type: "ping", to: PEER });
  });

  it("disables the button on rate_limited and re-enables after retryAfterSec", () => {
    const { dispatcher, send, btn } = setup();
    fireEvent.click(btn());
    act(() => {
      dispatcher.dispatch(JSON.stringify({ type: "error", code: "rate_limited", retryAfterSec: 7 }));
    });
    expect(btn().disabled).toBe(true);
    fireEvent.click(btn());
    expect(send).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(6999);
    });
    expect(btn().disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(btn().disabled).toBe(false);
  });

  it("shows a not-delivered indication within 2 s of the ping", () => {
    const { dispatcher, btn } = setup();
    fireEvent.click(btn());
    act(() => {
      vi.advanceTimersByTime(1900);
      dispatcher.dispatch(JSON.stringify({ type: "error", code: "not_delivered" }));
    });
    expect(screen.getByRole("status").textContent).toContain("not delivered");
  });

  it("ignores error frames arriving more than 2 s after the ping", () => {
    const { dispatcher, btn } = setup();
    fireEvent.click(btn());
    act(() => {
      vi.advanceTimersByTime(2500);
      dispatcher.dispatch(JSON.stringify({ type: "error", code: "not_delivered" }));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("registerPingHandlers", () => {
  const frame = JSON.stringify({ type: "ping", from: PEER });

  it("plays sound, vibrates 500 ms and shakes for 1 s for a contact", () => {
    const dispatcher = createDispatcher({}, () => {});
    const playSound = vi.fn();
    const vibrate = vi.fn();
    const shake = vi.fn();
    registerPingHandlers(dispatcher, { ownPin: ME, isContact: () => true, playSound, vibrate, shake });
    dispatcher.dispatch(frame);
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(500);
    expect(VIBRATE_MS).toBe(500);
    expect(SHAKE_MS).toBe(1000);
    expect(shake).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(999);
    expect(shake).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(1);
    expect(shake).toHaveBeenLastCalledWith(false);
  });

  it("ignores pings from non-contacts", () => {
    const dispatcher = createDispatcher({}, () => {});
    const playSound = vi.fn();
    const vibrate = vi.fn();
    const shake = vi.fn();
    registerPingHandlers(dispatcher, { ownPin: ME, isContact: () => false, playSound, vibrate, shake });
    dispatcher.dispatch(frame);
    expect(playSound).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(shake).not.toHaveBeenCalled();
  });

  it("uses navigator.vibrate(500) and a mocked audio context by default", () => {
    const vib = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vib, configurable: true });
    const start = vi.fn();
    const osc = { type: "", frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start, stop: vi.fn() };
    const gainNode = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    osc.connect.mockReturnValue(gainNode);
    gainNode.connect.mockReturnValue(undefined);
    class FakeAudio {
      currentTime = 0;
      destination = {};
      resume = vi.fn();
      createOscillator = () => osc;
      createGain = () => gainNode;
    }
    vi.stubGlobal("AudioContext", FakeAudio);
    const dispatcher = createDispatcher({}, () => {});
    registerPingHandlers(dispatcher, { ownPin: ME, isContact: () => true, shake: () => {} });
    dispatcher.dispatch(frame);
    expect(vib).toHaveBeenCalledWith(500);
    expect(start).toHaveBeenCalledTimes(1);
    expect(() => playPingSound()).not.toThrow();
    delete (navigator as unknown as { vibrate?: unknown }).vibrate;
  });
});
