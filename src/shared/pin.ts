export const PIN_REGEX = /^[0-9A-F]{8}$/;

export function isValidPin(value: unknown): value is string {
  return typeof value === "string" && PIN_REGEX.test(value);
}

/** Generate a PIN from a byte source: 4 random bytes as 8 uppercase hex chars. */
export function generatePin(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(4);
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, "0").toUpperCase();
  }
  return out;
}
