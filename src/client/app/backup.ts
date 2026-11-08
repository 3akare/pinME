import { openBackup, parseSealed, sealBackup, MIN_PASSPHRASE } from "../crypto/backup";
import { exportSnapshot, importSnapshot, parseSnapshot } from "../storage/backup";
import { bootstrapApp, getLocalStore } from "./bootstrap";

export { MIN_PASSPHRASE };

/** Encrypted backup of this device's identity, PINs, contacts and chats, ready to download. */
export async function createBackupFile(passphrase: string): Promise<File> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error("weak_passphrase");
  const store = await getLocalStore();
  const sealed = await sealBackup(await exportSnapshot(store), passphrase);
  const day = new Date(sealed.createdAt).toISOString().slice(0, 10);
  return new File([JSON.stringify(sealed)], `pinme-backup-${day}.pinme`, { type: "application/json" });
}

export type RestoreResult = "restored" | "not_a_backup" | "wrong_passphrase" | "has_identity" | "corrupt";

/** Restores a backup onto a device that has no identity yet, then connects every PIN. */
export async function restoreBackupFile(file: Blob, passphrase: string): Promise<RestoreResult> {
  let sealedRaw: unknown;
  try {
    sealedRaw = JSON.parse(await file.text());
  } catch {
    return "not_a_backup";
  }
  const sealed = parseSealed(sealedRaw);
  if (!sealed) return "not_a_backup";
  const plain = await openBackup(sealed, passphrase);
  if (!plain) return "wrong_passphrase";
  const snapshot = parseSnapshot(plain);
  if (!snapshot) return "corrupt";
  const result = await importSnapshot(await getLocalStore(), snapshot);
  if (result === "restored") await bootstrapApp(true);
  return result;
}

/** Saves a file through the browser's download. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
