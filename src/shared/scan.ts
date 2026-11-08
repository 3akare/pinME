import { isValidPin } from "./pin";

export type ScanResult = "accept" | "own-pin" | "invalid";

/**
 * Classify decoded barcode text.
 * - `accept`: a valid PIN that is not one of the user's own PINs
 * - `own-pin`: a valid PIN that is one of the user's own PINs
 * - `invalid`: anything else
 */
export function classifyScan(text: string, ownPins: Iterable<string>): ScanResult {
  if (!isValidPin(text)) return "invalid";
  for (const own of ownPins) {
    if (own === text) return "own-pin";
  }
  return "accept";
}
