import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { createBackupFile, downloadFile, MIN_PASSPHRASE } from "../../client/app/backup";
import { groupActions } from "../../client/app/bootstrap";
import { useContactsStore } from "../../client/state/contacts";
import { GROUP_NAME_MAX, MAX_GROUP_MEMBERS } from "../../shared/limits";
import { Avatar } from "../ui/Avatar";
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

/** Pick contacts of the current PIN and a name; everyone picked is in the group at once. */
export function NewGroupSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const activePin = usePinsStore((s) => s.activePin);
  const contacts = useContactsStore((s) => s.contacts);
  const mine = useMemo(
    () => contacts.filter((c) => c.ownPin === activePin && !c.unavailable).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [contacts, activePin],
  );
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const max = MAX_GROUP_MEMBERS - 1;

  function toggle(pin: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(pin)) next.delete(pin);
      else if (next.size < max) next.add(pin);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !activePin) return;
    if (!name.trim()) return setError("Give the group a name.");
    if (picked.size === 0) return setError("Pick at least one contact.");
    setBusy(true);
    setError(undefined);
    const res = await (await groupActions()).create(activePin, name, [...picked]);
    if (res.ok) {
      onClose();
      void navigate({ to: "/g/$groupId", params: { groupId: res.group.groupId } });
      return;
    }
    setBusy(false);
    setError(
      res.code === "disconnected"
        ? "You are offline. Try again when connected."
        : res.code === "not_a_contact"
          ? "Someone picked is no longer a contact."
          : "Could not make the group. Try again.",
    );
  }

  return (
    <Modal variant="sheet" labelledBy="group-title" onDismiss={busy ? undefined : onClose}>
      <SheetHead id="group-title" title="New group" onClose={onClose} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <label htmlFor="group-name" className="text-sm font-medium text-ink-2">
          Group name
        </label>
        <input
          id="group-name"
          value={name}
          maxLength={GROUP_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekend trip"
          className="field"
        />
        <fieldset className="mt-2">
          <legend className="mb-2 flex w-full justify-between text-sm font-medium text-ink-2">
            <span>Members</span>
            <span className="text-muted [font-variant-numeric:lining-nums_tabular-nums]">
              {picked.size} of {max}
            </span>
          </legend>
          {mine.length === 0 ? (
            <p className="text-sm text-muted">Add contacts first; a group is made from people you already chat with.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto border-t border-rule pane-scroll">
              {mine.map((c) => (
                <li key={c.contactPin} className="border-b border-rule">
                  <label className="flex cursor-pointer items-center gap-3 px-1 py-2.5">
                    <input
                      type="checkbox"
                      checked={picked.has(c.contactPin)}
                      onChange={() => toggle(c.contactPin)}
                      disabled={!picked.has(c.contactPin) && picked.size >= max}
                      className="h-4 w-4 accent-accent focus-visible:outline-2 focus-visible:outline-focus"
                    />
                    <Avatar name={c.displayName} picture={c.picture} size={32} />
                    <span className="truncate text-ink">{c.displayName}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-error">
          {error}
        </p>
        <p className="text-sm text-muted">
          Members can message each other here even if they are not contacts. Names and messages stay encrypted.
        </p>
        <button type="submit" disabled={busy || mine.length === 0} aria-busy={busy || undefined} className="btn btn--primary self-start">
          {busy ? "Making…" : "Make group"}
        </button>
      </form>
    </Modal>
  );
}
