import { describe, expect, it, vi } from "vitest";
import { createDispatcher } from "./dispatch";

describe("dispatcher", () => {
  it("routes valid frames to the registered handler", () => {
    const d = createDispatcher();
    const h = vi.fn();
    d.register("typing", h);
    d.dispatch(JSON.stringify({ type: "typing", from: "ABCDEF12" }));
    expect(h).toHaveBeenCalledWith({ type: "typing", from: "ABCDEF12" });
  });

  it("discards invalid frames and logs only type and field", () => {
    const log = vi.fn();
    const d = createDispatcher({}, log);
    const h = vi.fn();
    d.register("typing", h);
    expect(d.dispatch(JSON.stringify({ type: "typing", from: "secret-value" }))).toBeNull();
    expect(d.dispatch("not json")).toBeNull();
    expect(h).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-value");
  });
});
