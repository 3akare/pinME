/**
 * Deterministic canonical encoding of a signed request (Req 19.2).
 *
 * Layout: DOMAIN bytes, then for each field in fixed order
 * (pin, action, ts, nonce, payload) a 4-byte big-endian length followed by the
 * UTF-8 bytes of the field. Length prefixes make the encoding injective.
 * The payload is encoded as JSON with object keys sorted recursively.
 */

export const CANONICAL_DOMAIN = "pinme/v1";

export interface CanonicalFields {
  pin: string;
  action: string;
  ts: number;
  nonce: string;
  payload: unknown;
}

const encoder = new TextEncoder();

/** JSON with recursively sorted object keys; undefined becomes null. */
export function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${stableStringify(obj[key])}`);
    }
    return `{${parts.join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("canonical: non-finite number");
  }
  return JSON.stringify(value);
}

export function canonicalize(req: CanonicalFields): Uint8Array {
  const fields = [
    encoder.encode(CANONICAL_DOMAIN),
    encoder.encode(req.pin),
    encoder.encode(req.action),
    encoder.encode(String(req.ts)),
    encoder.encode(req.nonce),
    encoder.encode(stableStringify(req.payload)),
  ];
  // Domain prefix is length-prefixed too, so every segment is self-delimiting.
  const total = fields.reduce((n, f) => n + 4 + f.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const f of fields) {
    view.setUint32(offset, f.length, false);
    out.set(f, offset + 4);
    offset += 4 + f.length;
  }
  return out;
}
