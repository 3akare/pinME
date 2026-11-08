import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { bootstrapApp, connectToTarget } from "../client/app/bootstrap";
import { createIdentity } from "../client/app/identity";
import type { ConnectOutcome } from "../client/invites/connect";
import { addErrorMessage } from "../client/invites/messages";
import { validateDisplayName } from "../client/onboarding/form";
import { useContactsStore } from "../client/state/contacts";
import { useIdentityStore } from "../client/state/identity";
import { usePinsStore } from "../client/state/pins";
import { INVITE_TOKEN, type InviteTarget } from "../shared/scan";
import { isValidPin } from "../shared/pin";
import { getPublicProfileFn } from "../server/functions/pins";
import { Avatar } from "../components/ui/Avatar";
import { Ghost } from "../components/ui/Ghost";

export const Route = createFileRoute("/i/$pin")({
  component: Connect,
});

type Phase =
  | { kind: "loading" }
  | { kind: "name" }
  | { kind: "connecting" }
  | { kind: "waiting"; viaCode: boolean }
  | { kind: "own" }
  | { kind: "error"; message: string };

function errorText(o: Extract<ConnectOutcome, { kind: "error" }>): string {
  return o.code === "unknown_pin" ? "Your PIN is not ready on this device yet. Reload and try again." : addErrorMessage(o.code, o.retryAfterSec);
}

/**
 * Where every code and link lands, from a phone camera or the in-app scanner. It connects on
 * its own and opens the chat; a newcomer only types a name first.
 */
function Connect() {
  const { pin } = Route.useParams();
  const navigate = useNavigate();
  const identity = useIdentityStore((s) => s.identity);
  const loaded = useIdentityStore((s) => s.loaded);
  const activePin = usePinsStore((s) => s.activePin);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState<string | null>(null);
  const token = useRef<string | undefined>(undefined);
  const started = useRef(false);

  // Read the link token once, then drop it from the address bar so it is not shared onward.
  useEffect(() => {
    const t = location.hash.slice(1);
    if (INVITE_TOKEN.test(t)) token.current = t;
    if (location.hash) history.replaceState(history.state, "", location.pathname);
    void bootstrapApp();
  }, []);

  useEffect(() => {
    if (!isValidPin(pin)) return;
    void (getPublicProfileFn({ data: { pin } }) as Promise<{ ok: boolean; value?: { displayName: string }; code?: string }>)
      .then((r) => {
        if (r.ok && r.value) setName(r.value.displayName);
        else if (r.code === "not_found" || r.code === "pin_burned")
          setPhase({ kind: "error", message: addErrorMessage(r.code) });
      })
      .catch(() => {});
  }, [pin]);

  async function connect(own: string) {
    setPhase({ kind: "connecting" });
    const target: InviteTarget = token.current ? { pin, token: token.current } : { pin };
    const out = await connectToTarget(own, target).catch(() => ({ kind: "error", code: "network" }) as const);
    if (out.kind === "chat" || out.kind === "accepted") {
      void navigate({ to: "/chat/$pin", params: { pin }, replace: true });
    } else if (out.kind === "waiting") {
      setPhase({ kind: "waiting", viaCode: !!token.current });
    } else if (out.kind === "own") {
      setPhase({ kind: "own" });
    } else {
      setPhase({ kind: "error", message: errorText(out) });
    }
  }

  // Decide once the device's identity is known.
  useEffect(() => {
    if (!isValidPin(pin)) {
      setPhase({ kind: "error", message: "That link does not hold a PinMe code." });
      return;
    }
    if (!loaded || started.current) return;
    if (!identity) {
      setPhase((p) => (p.kind === "loading" ? { kind: "name" } : p));
      return;
    }
    if (!activePin) return;
    started.current = true;
    void connect(activePin);
  }, [loaded, identity, activePin, pin]);

  // Waiting: open the chat the moment they accept (instantly for a scanned code).
  const connected = useContactsStore((s) => s.contacts.some((c) => c.contactPin === pin && !c.unavailable));
  useEffect(() => {
    if (phase.kind === "waiting" && connected) void navigate({ to: "/chat/$pin", params: { pin }, replace: true });
  }, [phase.kind, connected, pin, navigate]);

  const who = name ?? pin;

  return (
    <main className="flex min-h-dvh flex-col bg-paper">
      <div className="container flex h-16 items-center">
        <Link to="/" className="font-display text-2xl text-ink no-underline">
          PinMe
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
          {phase.kind === "error" || phase.kind === "own" ? (
            <Ghost className="w-16 text-paper-3" />
          ) : (
            <Avatar name={who} size={88} />
          )}
          {phase.kind === "name" ? (
            <NameStep who={who} onDone={() => setPhase({ kind: "loading" })} />
          ) : phase.kind === "waiting" ? (
            <>
              <h1 className="text-[length:var(--text-display-s)]">
                {phase.viaCode ? `Connecting to ${who}` : `Request sent to ${who}`}
              </h1>
              <p role="status" className="lead text-ink-2">
                {phase.viaCode
                  ? "The chat opens the moment their PinMe is online. You can leave this page; it opens in your chats too."
                  : "The chat opens here when they accept. You will also see it in your chats."}
              </p>
              <Link to="/" className="btn btn--quiet">
                Go to my chats
              </Link>
            </>
          ) : phase.kind === "own" ? (
            <>
              <h1 className="text-[length:var(--text-display-s)]">That is your own code.</h1>
              <p className="lead text-ink-2">Show it to someone else, or scan theirs.</p>
              <Link to="/" className="btn btn--primary">
                Go to my chats
              </Link>
            </>
          ) : phase.kind === "error" ? (
            <>
              <h1 className="text-[length:var(--text-display-s)]">Could not connect.</h1>
              <p role="alert" className="lead text-ink-2">
                {phase.message}
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                {activePin && isValidPin(pin) ? (
                  <button type="button" className="btn btn--primary" onClick={() => void connect(activePin)}>
                    Try again
                  </button>
                ) : null}
                <Link to="/" className="btn btn--quiet">
                  Go to my chats
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[length:var(--text-display-s)]">Chat with {who}</h1>
              <p role="status" className="lead text-ink-2">
                Connecting…
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/** A newcomer's whole sign-up: one name, then the connect runs on its own. */
function NameStep({ who, onDone }: { who: string; onDone: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const err = validateDisplayName(displayName);
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      const res = await createIdentity({ displayName });
      if (res.ok) return onDone();
      setError(res.kind === "validation" ? res.errors.displayName : res.message);
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  return (
    <>
      <h1 className="text-[length:var(--text-display-s)]">Chat with {who}</h1>
      <p className="lead text-ink-2">Pick a name. No phone number, no email.</p>
      <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-2 text-left">
        <label htmlFor="displayName" className="text-sm font-medium text-ink-2">
          Your name
        </label>
        <div className="flex gap-2">
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="nickname"
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby="displayName-error"
            className="field flex-1"
          />
          <button type="submit" disabled={busy} aria-busy={busy || undefined} className="btn btn--primary">
            {busy ? "Starting…" : "Start chatting"}
          </button>
        </div>
        <p id="displayName-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-error">
          {error}
        </p>
      </form>
    </>
  );
}
