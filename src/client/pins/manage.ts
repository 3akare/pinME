import { MAX_ACTIVE_PINS } from "../../shared/limits";
import { isValidPinLabel } from "../../shared/validation";
import type { ConnectionManager } from "../net/manager";
import type { PinRecord } from "../storage";
import { createPin, type CreatePinDeps } from "./createPin";

export const PIN_LABEL_MESSAGE = "PIN label must be 1 to 24 characters";
export const MAX_PINS_MESSAGE = "Maximum number of Active PINs reached";

export type PinManageErrorCode = "invalid_label" | "limit_reached" | "unknown_pin";

export class PinManageError extends Error {
  constructor(
    message: string,
    readonly code: PinManageErrorCode,
  ) {
    super(message);
    this.name = "PinManageError";
  }
}

export function countActivePins(pins: readonly PinRecord[]): number {
  return pins.filter((p) => p.status === "active").length;
}

export interface ManagePinsDeps {
  /** Current PIN records. */
  getPins: () => PinRecord[];
  createPinDeps: CreatePinDeps;
  /** Local_Store write only; renames never touch the network. */
  savePin: (record: PinRecord) => Promise<void>;
  connections: ConnectionManager;
  /** Notifies UI state that a PIN was added or changed. */
  onPinChanged?: (record: PinRecord) => void;
}

/**
 * Creates an additional PIN. Validates label and limit before any network
 * call; the PIN is stored and connected only after registration succeeds
 * (createPin throws otherwise, leaving no trace).
 */
export async function createAdditionalPin(
  deps: ManagePinsDeps,
  input: { displayName: string; label: string },
): Promise<PinRecord> {
  if (!isValidPinLabel(input.label)) throw new PinManageError(PIN_LABEL_MESSAGE, "invalid_label");
  if (countActivePins(deps.getPins()) >= MAX_ACTIVE_PINS) {
    throw new PinManageError(MAX_PINS_MESSAGE, "limit_reached");
  }
  const record = await createPin(deps.createPinDeps, {
    displayName: input.displayName,
    label: input.label.trim(),
  });
  deps.onPinChanged?.(record);
  deps.connections.add(record);
  return record;
}

/** Renames a PIN in the Local_Store only; invalid labels leave it unchanged. */
export async function renamePin(deps: ManagePinsDeps, pin: string, label: string): Promise<PinRecord> {
  if (!isValidPinLabel(label)) throw new PinManageError(PIN_LABEL_MESSAGE, "invalid_label");
  const existing = deps.getPins().find((p) => p.pin === pin);
  if (!existing) throw new PinManageError("Unknown PIN", "unknown_pin");
  const updated: PinRecord = { ...existing, label: label.trim() };
  await deps.savePin(updated);
  deps.onPinChanged?.(updated);
  return updated;
}
