// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BURN_FAILED_MESSAGE, BURN_TIMEOUT_MS, burnPinFlow, type BurnFlowDeps } from "../../client/pins/burn";
import { BurnControl } from "./BurnControl";
import { GHOST_REDUCED_DURATION_MS } from "./GhostAnimation";

const own = { pin: "0A1B2C3D", signSk: new Uint8Array(32) };

function makeDeps(over: Partial<BurnFlowDeps> = {}) {
  const calls: string[] = [];
  const deps: BurnFlowDeps = {
    signRequest: () => new Uint8Array(64),
    randomBytes: (n) => new Uint8Array(n),
    burnPinFn: vi.fn(async () => ({ ok: true })),
    playAnimation: vi.fn(async () => void calls.push("animation")),
    cleanup: vi.fn(async () => void calls.push("cleanup")),
    closeSession: vi.fn(() => void calls.push("close")),
    updateStores: vi.fn(() => void calls.push("stores")),
    ...over,
  };
  return { deps, calls };
}

function renderControl(deps: BurnFlowDeps) {
  return render(
    <BurnControl
      pin={own.pin}
      label="Marketplace"
      run={({ playAnimation }) => burnPinFlow({ ...deps, playAnimation }, own)}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  // Reduced motion for a short, deterministic animation.
  window.matchMedia = ((q: string) => ({ matches: true, media: q })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BurnControl (jsdom)", () => {
  it("cancel closes the dialog and changes nothing", () => {
    const { deps } = makeDeps();
    renderControl(deps);
    fireEvent.click(screen.getByText("Burn this PIN"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deps.burnPinFn).not.toHaveBeenCalled();
    expect(deps.playAnimation).not.toHaveBeenCalled();
    expect(deps.cleanup).not.toHaveBeenCalled();
    expect(deps.closeSession).not.toHaveBeenCalled();
    expect(deps.updateStores).not.toHaveBeenCalled();
  });

  it("network error keeps data, skips the animation and shows the failure message", async () => {
    const { deps } = makeDeps({ burnPinFn: vi.fn(async () => Promise.reject(new Error("net"))) });
    renderControl(deps);
    fireEvent.click(screen.getByText("Burn this PIN"));
    await act(async () => {
      fireEvent.click(screen.getByText("Burn PIN"));
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(BURN_FAILED_MESSAGE)).toBeTruthy();
    expect(screen.queryByTestId("ghost-animation")).toBeNull();
    expect(deps.playAnimation).not.toHaveBeenCalled();
    expect(deps.cleanup).not.toHaveBeenCalled();
    expect(deps.closeSession).not.toHaveBeenCalled();
    expect(deps.updateStores).not.toHaveBeenCalled();
  });

  it("10 s timeout keeps data and skips the animation", async () => {
    const { deps } = makeDeps({ burnPinFn: vi.fn(() => new Promise<{ ok: boolean }>(() => {})) });
    renderControl(deps);
    fireEvent.click(screen.getByText("Burn this PIN"));
    await act(async () => {
      fireEvent.click(screen.getByText("Burn PIN"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BURN_TIMEOUT_MS - 1);
    });
    expect(screen.queryByText(BURN_FAILED_MESSAGE)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText(BURN_FAILED_MESSAGE)).toBeTruthy();
    expect(screen.queryByTestId("ghost-animation")).toBeNull();
    expect(deps.playAnimation).not.toHaveBeenCalled();
    expect(deps.cleanup).not.toHaveBeenCalled();
  });

  it("server ok:false keeps data and skips the animation", async () => {
    const { deps } = makeDeps({ burnPinFn: vi.fn(async () => ({ ok: false })) });
    renderControl(deps);
    fireEvent.click(screen.getByText("Burn this PIN"));
    await act(async () => {
      fireEvent.click(screen.getByText("Burn PIN"));
    });
    expect(screen.getByText(BURN_FAILED_MESSAGE)).toBeTruthy();
    expect(deps.cleanup).not.toHaveBeenCalled();
  });

  it("success plays the animation first, then cleans up", async () => {
    const { deps, calls } = makeDeps();
    renderControl(deps);
    fireEvent.click(screen.getByText("Burn this PIN"));
    await act(async () => {
      fireEvent.click(screen.getByText("Burn PIN"));
    });
    // Animation is showing; cleanup has not yet run.
    expect(screen.getByTestId("ghost-animation")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deps.cleanup).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GHOST_REDUCED_DURATION_MS);
    });
    expect(calls).toEqual(["cleanup", "close", "stores"]);
    expect(deps.cleanup).toHaveBeenCalledWith(own.pin);
    expect(screen.queryByTestId("ghost-animation")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
