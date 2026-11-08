import { bytesToBase64 } from "../../shared/base64";
import { generatePin } from "../../shared/pin";
import { newInviteToken } from "../../shared/scan";
import type { ErrorCode } from "../../shared/protocol";
import type { PinKeys } from "../crypto";
import type { PinRecord } from "../storage";

/** Initial attempt plus 5 retries = 6 attempts total (Req 2.5, 2.6). */
export const MAX_RETRIES = 5;
export const PIN_CREATION_FAILED = "PIN creation failed";

export type RegisterResult =
  | { ok: true }
  | { ok: false; code: ErrorCode | string; field?: string };

export interface RegisterBody {
  pin: string;
  boxPublicKey: string;
  signPublicKey: string;
  displayName: string;
}

export interface CreatePinDeps {
  randomBytes: (n: number) => Uint8Array;
  generatePinKeys: () => PinKeys;
  /** Wraps the registerPin server function; only public data is sent. */
  registerPin: (body: RegisterBody) => Promise<RegisterResult>;
  /** Persists the full record (including private keys) to the Local_Store. */
  savePin: (record: PinRecord) => Promise<void>;
  now?: () => number;
}

export interface CreatePinInput {
  displayName: string;
  label: string;
}

export class PinCreationError extends Error {
  constructor(
    message: string,
    readonly code: "collision" | "registration_failed",
  ) {
    super(message);
    this.name = "PinCreationError";
  }
}

/**
 * Generates a PIN and key pair, registers the public data, and persists the
 * record locally only after registration succeeds. Collisions discard the PIN
 * and keys and retry up to MAX_RETRIES times; after that, nothing is stored.
 */
export async function createPin(deps: CreatePinDeps, input: CreatePinInput): Promise<PinRecord> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const pin = generatePin(deps.randomBytes);
    const keys = deps.generatePinKeys();
    const result = await deps.registerPin({
      pin,
      boxPublicKey: bytesToBase64(keys.box.publicKey),
      signPublicKey: bytesToBase64(keys.sign.publicKey),
      displayName: input.displayName,
    });
    if (result.ok) {
      const record: PinRecord = {
        pin,
        label: input.label,
        boxSk: keys.box.privateKey,
        boxPk: keys.box.publicKey,
        signSk: keys.sign.privateKey,
        signPk: keys.sign.publicKey,
        status: "active",
        personalMessage: "",
        createdAt: (deps.now ?? Date.now)(),
        inviteToken: newInviteToken(deps.randomBytes),
      };
      await deps.savePin(record);
      return record;
    }
    if (result.code !== "collision") {
      throw new PinCreationError(PIN_CREATION_FAILED, "registration_failed");
    }
  }
  throw new PinCreationError(PIN_CREATION_FAILED, "collision");
}
