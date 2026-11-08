import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface BarcodeProps {
  pin: string;
  /** What the code encodes; defaults to the PIN. Pass the invite link so any camera app can open it. */
  value?: string;
  /** Rendered size in CSS px; never below 200. */
  size?: number;
}

const MIN_SIZE = 200;

/** Hex value of a theme token (the QR encoder needs plain hex). */
function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Renders a QR code on a rounded card with the PIN printed underneath. */
export function Barcode({ pin, value, size = MIN_SIZE }: BarcodeProps) {
  const content = value ?? pin;
  const px = Math.max(MIN_SIZE, size);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    QRCode.toDataURL(content, {
      width: px * 2, // 2x for crisp rendering on high-density screens
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: cssToken("--color-qr-dark"), light: cssToken("--color-qr-light") },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [content, px]);

  return (
    <figure className="m-0 flex flex-col items-center gap-4">
      <div
        className="flex items-center justify-center rounded-card bg-qr-light p-3"
        style={{ width: px + 16, height: px + 16, maxWidth: "100%" }}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={`QR code for PIN ${pin}`}
            width={px}
            height={px}
            style={{ width: px, height: px }}
          />
        ) : (
          <span className="text-sm text-qr-dark" role={failed ? "alert" : "status"}>
            {failed ? "Could not create the code" : "Drawing your code…"}
          </span>
        )}
      </div>
      <figcaption className="font-display text-3xl [font-variant-numeric:lining-nums_tabular-nums] text-ink">{pin}</figcaption>
    </figure>
  );
}
