/** Ed25519 verification via WebCrypto (Workers and Node 20+). */

import { base64ToBytes } from "./base64";

const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;

/** Copy into a fresh ArrayBuffer-backed view so it is a valid BufferSource. */
function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

/**
 * Verify an Ed25519 signature. Returns false (never throws) for malformed
 * keys, wrong lengths, or invalid signatures.
 */
export async function verifyEd25519(
  publicKeyRaw: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (publicKeyRaw.length !== PUBLIC_KEY_BYTES || signature.length !== SIGNATURE_BYTES) {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      toBuffer(publicKeyRaw),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      toBuffer(signature),
      toBuffer(message),
    );
  } catch {
    return false;
  }
}

/** Convenience wrapper for base64-encoded key and signature. */
export async function verifyEd25519Base64(
  publicKeyB64: string,
  message: Uint8Array,
  signatureB64: string,
): Promise<boolean> {
  try {
    return await verifyEd25519(base64ToBytes(publicKeyB64), message, base64ToBytes(signatureB64));
  } catch {
    return false;
  }
}
