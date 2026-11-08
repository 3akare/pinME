import { classifyScan } from "../../shared/scan";

/** Minimal camera abstraction so the session can be tested with a mock. */
export interface CameraScanner {
  /** Start the camera; rejects if permission is denied or no camera exists. */
  start(onDecoded: (text: string) => void): Promise<void>;
  /** Stop scanning and release the camera. Must be safe to call repeatedly. */
  stop(): Promise<void>;
}

export type ScanStatus =
  | "idle"
  | "starting"
  | "scanning"
  | "done"
  | "cancelled"
  | "camera-unavailable";

export interface ScanSessionOptions {
  camera: CameraScanner;
  ownPins: () => Iterable<string>;
  onPin: (pin: string) => void;
  onCancel: () => void;
  onManualEntry: () => void;
  /** Called on status or message changes. */
  onChange?: (state: ScanState) => void;
}

export interface ScanState {
  status: ScanStatus;
  /** User-facing message, or null. */
  message: string | null;
}

export const SCAN_MESSAGES = {
  invalid: "That is not a PinMe code. Keep scanning or type their PIN.",
  ownPin: "That is your own code. Scan theirs instead.",
  cameraUnavailable:
    "Camera unavailable: permission was denied or no camera was found. You can enter the PIN manually.",
} as const;

export class ScanSession {
  private state: ScanState = { status: "idle", message: null };
  private finished = false;

  constructor(private readonly opts: ScanSessionOptions) {}

  getState(): ScanState {
    return this.state;
  }

  private set(status: ScanStatus, message: string | null): void {
    this.state = { status, message };
    this.opts.onChange?.(this.state);
  }

  async start(): Promise<void> {
    if (this.state.status !== "idle") return;
    this.set("starting", null);
    try {
      await this.opts.camera.start((text) => this.handleDecoded(text));
    } catch {
      if (this.finished) {
        await this.release();
        return;
      }
      this.finished = true;
      await this.release();
      this.set("camera-unavailable", SCAN_MESSAGES.cameraUnavailable);
      return;
    }
    if (this.finished) {
      // cancelled or accepted while the camera was starting
      await this.release();
      return;
    }
    this.set("scanning", null);
  }

  private handleDecoded(text: string): void {
    if (this.finished) return;
    const result = classifyScan(text, this.opts.ownPins());
    if (result === "accept") {
      this.finished = true;
      this.set("done", null);
      void this.release().finally(() => this.opts.onPin(text));
      return;
    }
    const message = result === "own-pin" ? SCAN_MESSAGES.ownPin : SCAN_MESSAGES.invalid;
    if (this.state.message !== message) this.set("scanning", message);
  }

  /** Close the camera and report cancellation. */
  async cancel(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.set("cancelled", null);
    await this.release();
    this.opts.onCancel();
  }

  /** Offer manual entry (e.g. after camera failure). */
  manualEntry(): void {
    this.finished = true;
    void this.release();
    this.opts.onManualEntry();
  }

  /** Release the camera without invoking callbacks (e.g. on unmount). */
  async dispose(): Promise<void> {
    this.finished = true;
    await this.release();
  }

  private async release(): Promise<void> {
    try {
      await this.opts.camera.stop();
    } catch {
      /* camera already stopped */
    }
  }
}
