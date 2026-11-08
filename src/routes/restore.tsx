import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { restoreBackupFile, type RestoreResult } from "../client/app/backup";
import { useIdentityStore } from "../client/state/identity";

export const Route = createFileRoute("/restore")({
  component: Restore,
});

const MESSAGES: Record<Exclude<RestoreResult, "restored">, string> = {
  not_a_backup: "That file is not a PinMe backup.",
  wrong_passphrase: "Wrong passphrase, or the file was changed. Nothing was restored.",
  corrupt: "The backup opened but its contents are damaged. Nothing was restored.",
  has_identity: "This device already has a PinMe identity. Restore on a fresh browser or device.",
};

/** Brings an identity, its PINs, contacts and chats back onto a device that has none. */
function Restore() {
  const navigate = useNavigate();
  const identity = useIdentityStore((s) => s.identity);
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!file) return setError("Choose your backup file.");
    if (!pass) return setError("Enter the passphrase you chose for this backup.");
    setBusy(true);
    setError(undefined);
    try {
      const res = await restoreBackupFile(file, pass);
      if (res === "restored") {
        void navigate({ to: "/" });
        return;
      }
      setError(MESSAGES[res]);
    } catch {
      setError("Could not restore. Try again.");
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-dvh flex-col bg-paper">
      <div className="container flex h-16 items-center">
        <Link to="/" className="font-display text-2xl text-ink no-underline">
          PinMe
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <h1 className="text-[length:var(--text-display-s)]">Restore a backup.</h1>
          {identity && !busy ? (
            <>
              <p className="lead mt-4 text-ink-2">{MESSAGES.has_identity}</p>
              <Link to="/" className="btn btn--quiet mt-8">
                Go to my chats
              </Link>
            </>
          ) : (
            <>
              <p className="lead mt-4 text-ink-2">Your PINs, contacts and chats come back on this device.</p>
              <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-3">
                <label htmlFor="backup-file" className="text-sm font-medium text-ink-2">
                  Backup file
                </label>
                <input
                  id="backup-file"
                  type="file"
                  accept=".pinme,application/json"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-pill file:border-0 file:bg-paper-3 file:px-4 file:py-2 file:text-ink hover:file:bg-rule"
                />
                <label htmlFor="restore-pass" className="mt-2 text-sm font-medium text-ink-2">
                  Passphrase
                </label>
                <input
                  id="restore-pass"
                  type="password"
                  autoComplete="current-password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  aria-describedby="restore-error"
                  className="field"
                />
                <p id="restore-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-error">
                  {error}
                </p>
                <button type="submit" disabled={busy} aria-busy={busy || undefined} className="btn btn--primary self-start">
                  {busy ? "Restoring…" : "Restore"}
                </button>
              </form>
              <p className="mt-8 text-sm text-muted">
                Messages that arrived after the backup were delivered to the old device and are not in it.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
