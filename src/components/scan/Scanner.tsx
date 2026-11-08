import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useRef, useState } from "react";
import {
  ScanSession,
  type CameraScanner,
  type ScanState,
} from "../../client/scan/session";

export interface ScannerProps {
  ownPins: Iterable<string>;
  onPin: (pin: string) => void;
  onCancel: () => void;
  onManualEntry: () => void;
}

const READER_ID = "pinme-scanner-reader";

function createCamera(): CameraScanner {
  let qr: Html5Qrcode | null = null;
  let running = false;
  return {
    async start(onDecoded) {
      qr = new Html5Qrcode(READER_ID);
      await qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => onDecoded(text),
        () => {},
      );
      running = true;
    },
    async stop() {
      if (!qr) return;
      const instance = qr;
      qr = null;
      if (running) {
        running = false;
        await instance.stop();
      }
      instance.clear();
    },
  };
}

export function Scanner({ ownPins, onPin, onCancel, onManualEntry }: ScannerProps) {
  const [state, setState] = useState<ScanState>({ status: "idle", message: null });
  const sessionRef = useRef<ScanSession | null>(null);
  const propsRef = useRef({ ownPins, onPin, onCancel, onManualEntry });
  propsRef.current = { ownPins, onPin, onCancel, onManualEntry };

  useEffect(() => {
    const session = new ScanSession({
      camera: createCamera(),
      ownPins: () => propsRef.current.ownPins,
      onPin: (pin) => propsRef.current.onPin(pin),
      onCancel: () => propsRef.current.onCancel(),
      onManualEntry: () => propsRef.current.onManualEntry(),
      onChange: setState,
    });
    sessionRef.current = session;
    void session.start();
    return () => {
      void session.dispose();
    };
  }, []);

  const unavailable = state.status === "camera-unavailable";

  return (
    <section aria-label="Scan a PinMe code" className="flex flex-col gap-3">
      {!unavailable && (
        <div id={READER_ID} className="aspect-square w-full overflow-hidden rounded-card bg-paper-3" />
      )}
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-ink-2">
        {state.message ??
          (state.status === "scanning"
            ? "Point the camera at their code."
            : state.status === "starting"
              ? "Starting the camera…"
              : "")}
      </p>
      <div className="flex gap-2">
        {unavailable && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => sessionRef.current?.manualEntry()}>
            Enter PIN manually
          </button>
        )}
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => void sessionRef.current?.cancel()}>
          Cancel
        </button>
      </div>
    </section>
  );
}
