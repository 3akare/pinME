import sodium from "libsodium-wrappers";
import { canonicalize, type CanonicalFields } from "../../shared/canonical";

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface PinKeys {
  /** X25519 pair used for crypto_box encryption. */
  box: KeyPair;
  /** Ed25519 pair used for ownership proof. */
  sign: KeyPair;
}

/** Resolves once libsodium is initialised. Must be awaited before any other call. */
export async function ready(): Promise<void> {
  await sodium.ready;
}

/** Generates a fresh X25519 and Ed25519 key pair; unique per call (per PIN). */
export function generatePinKeys(): PinKeys {
  const box = sodium.crypto_box_keypair();
  const sign = sodium.crypto_sign_keypair();
  return {
    box: { publicKey: box.publicKey, privateKey: box.privateKey },
    sign: { publicKey: sign.publicKey, privateKey: sign.privateKey },
  };
}

/** Returns n cryptographically secure random bytes. */
export function randomBytes(n: number): Uint8Array {
  return sodium.randombytes_buf(n);
}

export interface Envelope {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/** Encrypts with crypto_box_easy using a fresh 24-byte random nonce per call. */
export function encrypt(
  plain: string,
  recipientBoxPk: Uint8Array,
  senderBoxSk: Uint8Array,
): Envelope {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    sodium.from_string(plain),
    nonce,
    recipientBoxPk,
    senderBoxSk,
  );
  return { nonce, ciphertext };
}

/** Decrypts an envelope; returns null on any failure. */
export function decrypt(
  env: Envelope,
  senderBoxPk: Uint8Array,
  recipientBoxSk: Uint8Array,
): string | null {
  try {
    const plain = sodium.crypto_box_open_easy(
      env.ciphertext,
      env.nonce,
      senderBoxPk,
      recipientBoxSk,
    );
    return sodium.to_string(plain);
  } catch {
    return null;
  }
}

/** Ed25519 detached signature over a server challenge. */
export function signChallenge(challenge: Uint8Array, signSk: Uint8Array): Uint8Array {
  return sodium.crypto_sign_detached(challenge, signSk);
}

/** Ed25519 detached signature over the canonical bytes of a request. */
export function signRequest(req: CanonicalFields, signSk: Uint8Array): Uint8Array {
  return sodium.crypto_sign_detached(canonicalize(req), signSk);
}
