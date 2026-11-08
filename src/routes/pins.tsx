import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { bootstrapApp } from "../client/app/bootstrap";
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
      <main className="mx-auto max-w-md p-6">
        <p role="status" aria-live="polite" className="text-muted">
          Loading...
        </p>
      </main>
    );
  }

  if (!identity) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p className="text-muted">
          You need an identity first.{" "}
          <Link to="/onboarding" className="text-accent underline">
            Go to onboarding
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <Link to="/" className="text-sm text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
        Back to contacts
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-accent">My PINs</h1>

      <section aria-labelledby="pins-heading" className="mt-4">
        <h2 id="pins-heading" className="sr-only">
          Active PINs
        </h2>
        {activePins.length === 0 ? (
          <p className="text-muted">You have no active PINs.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
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

      <section aria-labelledby="create-heading" className="mt-8">
        <h2 id="create-heading" className="text-lg font-semibold">
          Create a new PIN
        </h2>
        <form onSubmit={onCreate} noValidate className="mt-2 flex flex-col gap-2">
          <label htmlFor="newPinLabel" className="font-medium">
            PIN label
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="newPinLabel"
              type="text"
              autoComplete="off"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-describedby="newPinLabel-error"
              aria-invalid={createError ? true : undefined}
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-text focus-visible:outline-2 focus-visible:outline-accent"
            />
            <button
              type="submit"
              disabled={creating || atLimit}
              className="rounded-xl bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
            >
              {creating ? "Creating..." : "Create PIN"}
            </button>
          </div>
          <p id="newPinLabel-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-300">
            {createError}
          </p>
          {atLimit ? (
            <p className="text-sm text-muted">You have reached the maximum of {MAX_ACTIVE_PINS} active PINs.</p>
          ) : null}
        </form>
      </section>

      {detail ? (
        <section
          aria-labelledby="detail-heading"
          className="mt-8 flex flex-col gap-6 rounded-2xl border border-border bg-surface p-4"
        >
          <header>
            <h2 id="detail-heading" className="text-lg font-semibold">
              {detail.label}
            </h2>
            <p className="font-mono text-muted">{detail.pin}</p>
            {created === detail.pin ? (
              <p role="status" className="mt-2 text-sm text-green-300">
                New PIN ready. It has its own keys and contacts, and nobody can link it to your other PINs.
              </p>
            ) : null}
          </header>

          <PinShareCard key={detail.pin} pin={detail.pin} label={detail.label} />

          <div>
            <h3 className="mb-2 font-semibold">Status</h3>
            <StatusEditor
              key={detail.pin}
              initial={{ status: detail.presence ?? "available", personalMessage: detail.personalMessage }}
              onSave={async (change: StatusValues) => {
                const update = await buildProfileUpdater();
                return update(detail.pin, change);
              }}
            />
          </div>

          <div>
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
      ) : null}
    </main>
  );
}
