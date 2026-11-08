import { describe, it, expect } from "vitest";
import fc from "fast-check";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { PIN_REGEX } from "../../shared/pin";

// Feature: pinme-burnable-pin-messenger, Property 10: Barcode round trip
// jsqr is a test-only headless decoder (html5-qrcode needs a browser/camera).

const SCALE = 6;
const MARGIN = 4; // quiet zone in modules

/** Rasterise the QR the same way the Barcode component encodes it (level M). */
function render(pin: string) {
  const qr = QRCode.create(pin, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const side = (n + MARGIN * 2) * SCALE;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / SCALE) - MARGIN;
      const my = Math.floor(y / SCALE) - MARGIN;
      if (mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(my, mx)) {
        const i = (y * side + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, side };
}

const pinArb = fc
  .stringMatching(/^[0-9A-F]{8}$/)
  .filter((p) => PIN_REGEX.test(p));

describe("Property 10: Barcode round trip", () => {
  /** **Validates: Requirements 5.6** */
  it("decoding the encoded barcode yields the original PIN", () => {
    fc.assert(
      fc.property(pinArb, (pin) => {
        const { data, side } = render(pin);
        const result = jsQR(data, side, side);
        expect(result?.data).toBe(pin);
      }),
      { numRuns: 100 },
    );
  });
});
