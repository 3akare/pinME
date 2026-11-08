import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CameraScanner, SCAN_MESSAGES, ScanSession } from "./session";

const OWN = "AAAAAAAA";
const OTHER = "1234ABCD";

function setup(opts: { startError?: Error } = {}) {
  let decode: (text: string) => void = () => {};
  const camera: CameraScanner = {
    start: vi.fn(async (cb) => {
      if (opts.startError) throw opts.startError;
      decode = cb;
    }),
    stop: vi.fn(async () => {}),
  };
  const onPin = vi.fn();
  const onCancel = vi.fn();
  const onManualEntry = vi.fn();
  const session = new ScanSession({
    camera,
    ownPins: () => [OWN],
    onPin,
    onCancel,
    onManualEntry,
  });
  return { session, camera, onPin, onCancel, onManualEntry, emit: (t: string) => decode(t) };
}

describe("ScanSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("valid PIN stops scanning, closes camera within 1s, then calls onPin", async () => {
    const t = setup();
    await t.session.start();
    expect(t.session.getState().status).toBe("scanning");

    t.emit(OTHER);
    await vi.advanceTimersByTimeAsync(1000);

    expect(t.camera.stop).toHaveBeenCalledTimes(1);
    expect(t.onPin).toHaveBeenCalledWith(OTHER);
    expect(t.session.getState().status).toBe("done");
    const stopOrder = vi.mocked(t.camera.stop).mock.invocationCallOrder[0]!;
    const pinOrder = t.onPin.mock.invocationCallOrder[0]!;
    expect(stopOrder).toBeLessThan(pinOrder);

    // further decodes are ignored
    t.emit("BBBBBBBB");
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.onPin).toHaveBeenCalledTimes(1);
  });

  it("invalid content shows a message and keeps scanning", async () => {
    const t = setup();
    await t.session.start();
    t.emit("not a pin");
    await vi.advanceTimersByTimeAsync(1000);

    expect(t.session.getState()).toEqual({ status: "scanning", message: SCAN_MESSAGES.invalid });
    expect(t.camera.stop).not.toHaveBeenCalled();
    expect(t.onPin).not.toHaveBeenCalled();

    // a valid PIN is still accepted afterwards
    t.emit(OTHER);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.onPin).toHaveBeenCalledWith(OTHER);
  });

  it("own PIN shows a message and keeps scanning", async () => {
    const t = setup();
    await t.session.start();
    t.emit(OWN);
    await vi.advanceTimersByTimeAsync(1000);

    expect(t.session.getState()).toEqual({ status: "scanning", message: SCAN_MESSAGES.ownPin });
    expect(t.camera.stop).not.toHaveBeenCalled();
    expect(t.onPin).not.toHaveBeenCalled();
  });

  it.each([
    ["permission denied", new Error("NotAllowedError")],
    ["no camera", new Error("NotFoundError")],
  ])("%s shows a message and offers manual entry", async (_name, error) => {
    const t = setup({ startError: error });
    await t.session.start();

    expect(t.session.getState()).toEqual({
      status: "camera-unavailable",
      message: SCAN_MESSAGES.cameraUnavailable,
    });
    expect(t.onPin).not.toHaveBeenCalled();
    expect(t.onCancel).not.toHaveBeenCalled();

    t.session.manualEntry();
    expect(t.onManualEntry).toHaveBeenCalledTimes(1);
  });

  it("cancel closes the camera within 1s and only reports cancellation", async () => {
    const t = setup();
    await t.session.start();
    const p = t.session.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    await p;

    expect(t.camera.stop).toHaveBeenCalledTimes(1);
    expect(t.onCancel).toHaveBeenCalledTimes(1);
    expect(t.onPin).not.toHaveBeenCalled();
    expect(t.onManualEntry).not.toHaveBeenCalled();
    expect(t.session.getState().status).toBe("cancelled");

    // late decodes after cancel are ignored
    t.emit(OTHER);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.onPin).not.toHaveBeenCalled();
  });
});
