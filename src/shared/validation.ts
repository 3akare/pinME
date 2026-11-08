import {
  DISPLAY_NAME_MAX,
  PERSONAL_MESSAGE_MAX,
  PIN_LABEL_MAX,
} from "./limits";

function trimmedWithin(value: unknown, max: number): boolean {
  if (typeof value !== "string") return false;
  const t = value.trim();
  return t.length >= 1 && t.length <= max;
}

/** Display name: trimmed length 1-32. */
export function isValidDisplayName(value: unknown): boolean {
  return trimmedWithin(value, DISPLAY_NAME_MAX);
}

/** PIN_Label: trimmed length 1-24. */
export function isValidPinLabel(value: unknown): boolean {
  return trimmedWithin(value, PIN_LABEL_MAX);
}

/** Personal_Message: length 0-80. */
export function isValidPersonalMessage(value: unknown): boolean {
  return typeof value === "string" && value.length <= PERSONAL_MESSAGE_MAX;
}
