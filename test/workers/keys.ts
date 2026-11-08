import { bytesToBase64 } from "../../src/shared/base64";

/** Deterministic Ed25519 test identity so the Worker side and the test agree on keys. */
export const ACTIVE_PIN = "AAAAAAAA";
export const BURNED_PIN = "BBBBBBBB";
export const UNKNOWN_PIN = "CCCCCCCC";

// PKCS#8 prefix for an Ed25519 private key; the 32-byte seed follows.
const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function pkcs8(seedByte: number): Uint8Array {
  const out = new Uint8Array(PKCS8_PREFIX.length + 32);
  out.set(PKCS8_PREFIX);
  out.fill(seedByte, PKCS8_PREFIX.length);
  return out;
}

export interface TestKeys {
  privateKey: CryptoKey;
  publicKeyB64: string;
}

/** Derives the key pair for a seed byte. Seed 1 is the registered identity; seed 2 is an impostor. */
export async function testKeys(seedByte: number): Promise<TestKeys> {
  const extractable = await crypto.subtle.importKey("pkcs8", pkcs8(seedByte) as BufferSource, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", extractable);
  const x = jwk.x!.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(x + "=".repeat((4 - (x.length % 4)) % 4));
  const pub = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return { privateKey: extractable, publicKeyB64: bytesToBase64(pub) };
}

/** Second registered identity (seed 3) used by the invite-flow integration test. */
export const INVITE_TEST_PIN_B = "DDDDDDDD";
export const INVITE_TEST_SEED_B = 3;
