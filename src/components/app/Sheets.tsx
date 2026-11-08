import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { createBackupFile, downloadFile, MIN_PASSPHRASE } from "../../client/app/backup";
import { usePinsStore } from "../../client/state/pins";
import { PIN_FORMAT_MESSAGE } from "../../client/invites/messages";
import { parseInvite } from "../../shared/scan";
import { PinShareCard } from "../pins/PinShareCard";
import { Scanner } from "../scan/Scanner";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";

function SheetHead({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      <button type="button" onClick={onClose} aria-label="Close" className="icon-btn">
        <Icon name="close" />
      </button>
    </div>
  );
}

/** Your code for the active PIN, ready to be scanned across the table or shared as a link. */
export function MyCodeSheet({ onClose }: { onClose: () => void }) {
  const pins = usePinsStore((s) => s.pins);
  const activePin = usePinsStore((s) => s.activePin);
  const active = pins.find((p) => p.pin === activePin);
  return (
    <Modal variant="sheet" labelledBy="my-code-title" onDismiss={onClose}>
      <SheetHead id="my-code-title" title="My code" onClose={onClose} />
      {pins.filter((p) => p.status === "active").length > 1 && active ? (
        <p className="-mt-2 mb-3 text-sm text-muted">For your {active.label} PIN. Switch PINs in Chats to share another.</p>
      ) : null}
      {active ? <PinShareCard pin={active.pin} /> : null}
    </Modal>
  );
}

/**
 * Point the camera at someone's code (or type their PIN) and go straight to the chat.
 * Scans and typed PINs both land on the connect link, which does the rest.
 */
export function ScanSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const pins = usePinsStore((s) => s.pins);
  const ownPins = useMemo(() => pins.map((p) => p.pin), [pins]);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | undefined>();

  function go(text: string) {
    const target = parseInvite(text.trim()) ?? parseInvite(text.trim().toUpperCase());
    if (!target) {
      setError(PIN_FORMAT_MESSAGE);
      return;
    }
    onClose();
    void navigate({ to: "/i/$pin", params: { pin: target.pin }, hash: target.token ?? "" });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    go(typed);
  }

  return (
    <Modal variant="sheet" labelledBy="scan-title" onDismiss={onClose}>
      <SheetHead id="scan-title" title="Scan a code" onClose={onClose} />
      <Scanner
        ownPins={ownPins}
        onPin={go}
        onCancel={onClose}
        onManualEntry={() => document.getElementById("contactPin")?.focus()}
      />
      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-2 border-t border-rule pt-4">
        <label htmlFor="contactPin" className="text-sm font-medium text-ink-2">
          Or type their PIN
        </label>
        <div className="flex gap-2">
          <input
            id="contactPin"
            name="contactPin"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setError(undefined);
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="2A4F9C1B"
            aria-invalid={error ? true : undefined}
            aria-describedby="contactPin-error"
            className="field flex-1 uppercase [font-variant-numeric:lining-nums_tabular-nums]"
          />
          <button type="submit" className="btn btn--primary">
            Chat
          </button>
        </div>
        <p id="contactPin-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-error">
          {error}
        </p>
        <p className="text-sm text-muted">A typed PIN sends a request they accept, since anyone could type one. Scanning skips that.</p>
      </form>
    </Modal>
  );
}

/** Encrypted backup of everything on this device, behind a passphrase only the user knows. */
export function BackupSheet({ onClose }: { onClose: () => void }) {
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pass.length < MIN_PASSPHRASE) return setError(`Use at least ${MIN_PASSPHRASE} characters.`);
    if (pass !== again) return setError("The two passphrases differ.");
    setError(undefined);
    setBusy(true);
    try {
      const file = await createBackupFile(pass);
      downloadFile(file);
      setDone(file.name);
      setPass("");
      setAgain("");
    } catch {
      setError("Could not create the backup. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal variant="sheet" labelledBy="backup-title" onDismiss={busy ? undefined : onClose}>
      <SheetHead id="backup-title" title="Back up" onClose={onClose} />
      <p className="text-ink-2">
        Your keys and chats live only on this device. A backup is one encrypted file you keep; restore it on a new device
        with the passphrase.
      </p>
      <p className="mt-3 text-sm text-muted">
        Anyone with the file and the passphrase can read your chats and use your PINs. Without the passphrase it cannot be
        opened, by anyone, including us.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-3">
        <label htmlFor="backup-pass" className="text-sm font-medium text-ink-2">
          Passphrase
        </label>
        <input
          id="backup-pass"
          type="password"
          autoComplete="new-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          aria-describedby="backup-error"
          className="field"
        />
        <label htmlFor="backup-again" className="text-sm font-medium text-ink-2">
          Passphrase again
        </label>
        <input
          id="backup-again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          aria-describedby="backup-error"
          className="field"
        />
        <p id="backup-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-error">
          {error}
        </p>
        {done ? (
          <p role="status" className="text-sm text-success">
            Saved as {done}. Keep it somewhere other than this device.
          </p>
        ) : null}
        <button type="submit" disabled={busy} aria-busy={busy || undefined} className="btn btn--primary self-start">
          {busy ? "Encrypting…" : "Download backup"}
        </button>
      </form>
    </Modal>
  );
}
