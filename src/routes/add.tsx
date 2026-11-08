import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Scanner } from "../components/scan/Scanner";
import { bootstrapApp, buildInviteFlow } from "../client/app/bootstrap";
import { addErrorMessage, PIN_FORMAT_MESSAGE } from "../client/invites/messages";
import { useIdentityStore } from "../client/state/identity";
import { usePinsStore } from "../client/state/pins";
import { isValidPin } from "../shared/pin";

export const Route = createFileRoute("/add")({
  // `/add?pin=XXXXXXXX` is the invite link shown next to a PIN's QR code.
  validateSearch: (search: Record<string, unknown>): { pin?: string } =>
    typeof search.pin === "string" ? { pin: search.pin.slice(0, 16) } : {},
  component: AddContact,
});

function AddContact() {
  const identity = useIdentityStore((s) => s.identity);
  const loaded = useIdentityStore((s) => s.loaded);
  const activePin = usePinsStore((s) => s.activePin);
  const pins = usePinsStore((s) => s.pins);
  const search = Route.useSearch();
  const [pin, setPin] = useState(() => search.pin?.toUpperCase() ?? "");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activePins = useMemo(() => pins.filter((p) => p.status === "active"), [pins]);
  const ownPins = useMemo(() => pins.map((p) => p.pin), [pins]);

  useEffect(() => {
    void bootstrapApp();
  }, []);

  function closeScanner() {
    setScanning(false);
    // Return focus to the PIN input once the scanner has unmounted.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function invite(raw: string) {
    if (busy) return;
    setFormError(undefined);
    setSentTo(null);
    const value = raw.trim().toUpperCase();
    // Validate the format before any request is made.
    if (!isValidPin(value)) {
      setFieldError(PIN_FORMAT_MESSAGE);
      return;
    }
    setFieldError(undefined);
    if (!activePin) {
      setFormError("Set up your identity first.");
      return;
    }
    setBusy(true);
    try {
      const flow = await buildInviteFlow();
      const res = await flow.sendInvite(activePin, value);
      if (res.ok) {
        setSentTo(value);
        setPin("");
      } else if (res.code === "validation_failed") {
        setFieldError(PIN_FORMAT_MESSAGE);
      } else {
        setFormError(addErrorMessage(res.code, res.retryAfterSec));
      }
    } catch {
      setFormError(addErrorMessage("unknown"));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void invite(pin);
  }

  return (
    <main className="mx-auto w-full max-w-md p-4 sm:p-6">
      <Link to="/" className="text-sm text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
        Back to contacts
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-accent">Add contact</h1>
      {loaded && !identity ? (
        <p className="mt-4 text-muted">
          You need an identity first.{" "}
          <Link to="/onboarding" className="text-accent underline">
            Go to onboarding
          </Link>
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
          <p className="text-sm text-muted">
            Scan their QR code or type their PIN. They get a prompt to accept, and you are told the moment they do.
          </p>
          {activePins.length > 1 ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="fromPin" className="font-medium">
                Send from
              </label>
              <select
                id="fromPin"
                value={activePin ?? ""}
                onChange={(e) => usePinsStore.getState().setActivePin(e.target.value)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-text focus-visible:outline-2 focus-visible:outline-accent"
              >
                {activePins.map((p) => (
                  <option key={p.pin} value={p.pin}>
                    {p.label} ({p.pin})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted">They will only ever see this PIN.</p>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <label htmlFor="contactPin" className="font-medium">
              Contact PIN
            </label>
            <div className="flex gap-2">
              <input
                id="contactPin"
                ref={inputRef}
                name="contactPin"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby="contactPin-error"
                className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 font-mono uppercase text-text focus-visible:outline-2 focus-visible:outline-accent"
              />
              <button
                type="button"
                onClick={() => setScanning(true)}
                aria-expanded={scanning}
                aria-controls="scanner-panel"
                disabled={scanning || busy}
                className="rounded-xl border border-border bg-surface px-3 py-2 font-medium text-text hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
              >
                Scan
              </button>
            </div>
            {scanning ? (
              <div id="scanner-panel" className="mt-2 rounded-xl border border-border bg-surface p-3">
                <Scanner
                  ownPins={ownPins}
                  onPin={(scanned) => {
                    setPin(scanned);
                    closeScanner();
                    // A successful scan is the intent to invite: send without a second tap.
                    void invite(scanned);
                  }}
                  onCancel={closeScanner}
                  onManualEntry={closeScanner}
                />
              </div>
            ) : null}
            <p id="contactPin-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-300">
              {fieldError}
            </p>
          </div>
          <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-300">
            {formError}
          </p>
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-green-300">
            {sentTo ? (
              <>
                Invite sent. <span className="font-mono">{sentTo}</span> gets a prompt to accept; you will be notified
                here and they will appear in your contacts.
              </>
            ) : null}
          </p>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {busy ? "Sending..." : "Send invite"}
          </button>
        </form>
      )}
    </main>
  );
}
