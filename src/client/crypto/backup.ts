import { base64ToBytes, bytesToBase64 } from "../../shared/base64";

/**
 * Passphrase sealing for identity backups, with WebCrypto only: PBKDF2-SHA-256 (600,000
 * iterations, per OWASP) derives an AES-256-GCM key. GCM authenticates the whole file, so a wrong
 * passphrase or a tampered file fails to open instead of restoring garbage.
 */
export const BACKUP_FORMAT = "pinme-backup";
export const BACKUP_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 10;

export interface SealedBackup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: number;
  kdf: { alg: "pbkdf2-sha256"; iterations: number; salt: string };
  cipher: { alg: "aes-256-gcm"; iv: string };
  data: string;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealBackup(
  plain: Uint8Array,
  passphrase: string,
  opts: { now?: number; iterations?: number } = {},
): Promise<SealedBackup> {
  const iterations = opts.iterations ?? BACKUP_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  return {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: opts.now ?? Date.now(),
    kdf: { alg: "pbkdf2-sha256", iterations, salt: bytesToBase64(salt) },
    cipher: { alg: "aes-256-gcm", iv: bytesToBase64(iv) },
    data: bytesToBase64(data),
  };
}

/** Reads the file's envelope; null when it is not a PinMe backup this version understands. */
export function parseSealed(raw: unknown): SealedBackup | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Partial<SealedBackup>;
  if (b.format !== BACKUP_FORMAT || b.version !== 1) return null;
  if (b.kdf?.alg !== "pbkdf2-sha256" || b.cipher?.alg !== "aes-256-gcm") return null;
  if (typeof b.data !== "string" || typeof b.kdf.salt !== "string" || typeof b.cipher.iv !== "string") return null;
  const it = b.kdf.iterations;
  if (typeof it !== "number" || !Number.isInteger(it) || it < 100_000 || it > 10_000_000) return null;
  return b as SealedBackup;
}

/** The plaintext, or null when the passphrase is wrong or the file was altered. */
export async function openBackup(sealed: SealedBackup, passphrase: string): Promise<Uint8Array | null> {
  try {
    const key = await deriveKey(passphrase, base64ToBytes(sealed.kdf.salt), sealed.kdf.iterations);
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(sealed.cipher.iv) as BufferSource },
        key,
        base64ToBytes(sealed.data) as BufferSource,
      ),
    );
  } catch {
    return null;
  }
}
