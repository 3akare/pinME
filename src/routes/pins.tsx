import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { bootstrapApp, resetPinLink } from "../client/app/bootstrap";
import { Icon } from "../components/ui/Icon";
import { buildBurnFlowDeps, buildManagePinsDeps, buildProfileUpdater } from "../client/app/pinsWiring";
import { createAdditionalPin, renamePin, PinManageError, countActivePins } from "../client/pins/manage";
import { PIN_CREATION_FAILED } from "../client/pins/createPin";
import { useContactsStore } from "../client/state/contacts";
import { useIdentityStore } from "../client/state/identity";
import { usePinsStore } from "../client/state/pins";
import { burnPinFlow } from "../client/pins/burn";
import { BurnControl } from "../components/pins/BurnControl";
import { PinCard } from "../components/pins/PinCard";
import { PinShareCard } from "../components/pins/PinShareCard";
import { StatusEditor, type StatusValues } from "../components/pins/StatusEditor";
import { MAX_ACTIVE_PINS } from "../shared/limits";

export const Route = createFileRoute("/pins")({
  component: PinManager,
});

function errorText(e: unknown): string {
  if (e instanceof PinManageError) return e.message;
  return e instanceof Error && e.message ? e.message : PIN_CREATION_FAILED;
}

function PinManager() {
  const identity = useIdentityStore((s) => s.identity);
  const loaded = useIdentityStore((s) => s.loaded);
  const pins = usePinsStore((s) => s.pins);
  const contacts = useContactsStore((s) => s.contacts);
  const [started, setStarted] = useState(false);
  const [label, setLabel] = useState("");
  const [createError, setCreateError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  /** PIN created in this visit; its detail panel explains what to do next. */
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bootstrapApp().then(() => {
      if (!cancelled) setStarted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activePins = useMemo(
    () => pins.filter((p) => p.status === "active").sort((a, b) => a.createdAt - b.createdAt),
    [pins],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) if (c.status === "active") m.set(c.ownPin, (m.get(c.ownPin) ?? 0) + 1);
    return m;
  }, [contacts]);
  const detail = activePins.find((p) => p.pin === selected);
  const atLimit = countActivePins(pins) >= MAX_ACTIVE_PINS;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (creating || !identity) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const deps = await buildManagePinsDeps();
      const record = await createAdditionalPin(deps, { displayName: identity.displayName, label });
      setLabel("");
      setSelected(record.pin);
      setCreated(record.pin);
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function onRename(pin: string, next: string): Promise<string | undefined> {
    try {
      await renamePin(await buildManagePinsDeps(), pin, next);
      return undefined;
    } catch (err) {
      return errorText(err);
    }
  }

  if (!started || !loaded) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper">
        <p role="status" aria-live="polite" className="text-muted">
          Loading your PINs…
        </p>
      </main>
    );
  }

  if (!identity) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper p-6 text-center">
        <p className="text-ink-2">You need an identity on this device first.</p>
        <Link to="/onboarding" className="btn btn--primary">
          Get your PIN
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-paper">
      <header className="flex h-16 items-center gap-3 border-b border-rule px-3 sm:px-5">
        <Link to="/" aria-label="Back to chats" className="icon-btn">
          <Icon name="back" />
        </Link>
        <h1 className="font-display text-2xl">My PINs</h1>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-12 gap-y-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="pins-heading">
            <h2 id="pins-heading" className="visually-hidden">
              Active PINs
            </h2>
            <p className="mb-2 text-ink-2">
              Give each place its own PIN. Burn one and only the people who had it lose you.
            </p>
            {activePins.length === 0 ? (
              <p className="text-muted">You have no active PINs.</p>
            ) : (
              <ul className="border-t border-rule">
                {activePins.map((p) => (
                  <li key={p.pin}>
                    <PinCard
                      pin={p.pin}
                      label={p.label}
                      contactCount={counts.get(p.pin) ?? 0}
                      selected={p.pin === selected}
                      onOpen={(pin) => {
                        setSelected(pin);
                        setCreated(null);
                      }}
                      onRename={onRename}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="create-heading">
            <h2 id="create-heading" className="font-display text-2xl">
              New PIN
            </h2>
            <form onSubmit={onCreate} noValidate className="mt-3 flex flex-col gap-2">
              <label htmlFor="newPinLabel" className="text-sm font-medium text-ink-2">
                PIN label
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="newPinLabel"
                  type="text"
                  autoComplete="off"
                  placeholder="Marketplace"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  aria-describedby="newPinLabel-error"
                  aria-invalid={createError ? true : undefined}
                  className="field min-w-0 flex-1"
                />
                <button type="submit" disabled={creating || atLimit} aria-busy={creating || undefined} className="btn btn--primary">
                  {creating ? "Creating…" : "Create PIN"}
                </button>
              </div>
              <p id="newPinLabel-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-error">
                {createError}
              </p>
              {atLimit ? (
                <p className="text-sm text-muted">You have reached the maximum of {MAX_ACTIVE_PINS} active PINs.</p>
              ) : null}
            </form>
          </section>
        </div>

        {detail ? (
          <section aria-labelledby="detail-heading" className="flex flex-col gap-8 rounded-card bg-paper-2 p-5 sm:p-8">
            <header>
              <h2 id="detail-heading" className="font-display text-3xl">
                {detail.label}
              </h2>
              {created === detail.pin ? (
                <p role="status" className="mt-2 text-success">
                  New PIN ready. It has its own keys and contacts, and nobody can link it to your other PINs.
                </p>
              ) : null}
            </header>

            <PinShareCard key={detail.pin} pin={detail.pin} />

            <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
              <p className="min-w-0 flex-1 text-sm text-muted">
                Anyone with this code or link connects without asking. Reset it to make old ones stop working.
              </p>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => void resetPinLink(detail.pin)}>
                Reset code
              </button>
            </div>

            <div className="border-t border-rule pt-5">
              <StatusEditor
                key={detail.pin}
                initial={{ status: detail.presence ?? "available", personalMessage: detail.personalMessage }}
                onSave={async (change: StatusValues) => {
                  const update = await buildProfileUpdater();
                  return update(detail.pin, change);
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
              <p className="min-w-0 flex-1 text-sm text-muted">
                Burning is permanent. Everyone who only had this PIN loses you, and it is never issued again.
              </p>
              <BurnControl
                key={detail.pin}
                pin={detail.pin}
                label={detail.label}
                run={async ({ playAnimation }) =>
                  burnPinFlow(await buildBurnFlowDeps(playAnimation), { pin: detail.pin, signSk: detail.signSk })
                }
              />
            </div>
          </section>
        ) : (
          <section className="hidden flex-col items-center justify-center gap-4 rounded-card bg-paper-2 p-8 text-center lg:flex">
            <p className="max-w-[28ch] font-display text-2xl text-ink-2">Pick a PIN to see its code, status and burn.</p>
          </section>
        )}
      </div>
    </main>
  );
}
