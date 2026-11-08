import { ERROR_CODES, MESSAGE_TYPES } from "./protocol";

export interface SafeLogFields {
  type?: (typeof MESSAGE_TYPES)[number] | "unknown";
  field?: string;
  code?: (typeof ERROR_CODES)[number];
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const clean = (v: string | undefined): string | undefined =>
  v === undefined ? undefined : SAFE_TOKEN.test(v) ? v : "redacted";

/**
 * The only logger allowed in src/server and src/durable.
 * Accepts an event name and type/field/code only; no free-form payloads.
 * Values that are not simple tokens are replaced with "redacted".
 */
export function safeLog(event: string, fields: SafeLogFields = {}): void {
  const entry = {
    event: clean(event) ?? "redacted",
    type: clean(fields.type),
    field: clean(fields.field),
    code: clean(fields.code),
  };
  console.warn(JSON.stringify(entry));
}
