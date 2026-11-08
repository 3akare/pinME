import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { bootstrapApp } from "../client/app/bootstrap";
import { useContactsStore } from "../client/state/contacts";
import { useIdentityStore } from "../client/state/identity";
import { usePinsStore } from "../client/state/pins";
import { ContactRow } from "../components/contacts/ContactRow";
import { InviteRow } from "../components/invites/InviteRow";
import { useInviteResponder } from "../components/invites/useInviteResponder";
import { PinShareCard } from "../components/pins/PinShareCard";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const loaded = useIdentityStore((s) => s.loaded);
  const identity = useIdentityStore((s) => s.identity);
  const pins = usePinsStore((s) => s.pins);
  const activePin = usePinsStore((s) => s.activePin);
  const contacts = useContactsStore((s) => s.contacts);
  const invites = useContactsStore((s) => s.pendingInvites);
  const [started, setStarted] = useState(false);
  const respond = useInviteResponder();

  useEffect(() => {
    let cancelled = false;
    void bootstrapApp().then((hasIdentity) => {
      if (cancelled) return;
      setStarted(true);
      if (!hasIdentity) void navigate({ to: "/onboarding" });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const openChat = (ownPin: string, pin: string) => {
    usePinsStore.getState().setActivePin(ownPin);
    void navigate({ to: "/chat/$pin", params: { pin } });
  };

  const myContacts = useMemo(
    () => contacts.filter((c) => c.ownPin === activePin),
    [contacts, activePin],
  );
  // Invites to every own PIN, oldest first: one sent to a PIN that is not selected must not go unseen.
  const sortedInvites = useMemo(() => [...invites].sort((a, b) => a.createdAt - b.createdAt), [invites]);
  const labelOf = (pin: string) => (pins.length > 1 ? pins.find((p) => p.pin === pin)?.label : undefined);
  const active = pins.find((p) => p.pin === activePin);

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
        <h1 className="text-3xl font-bold text-accent">PinMe</h1>
        <p className="mt-2 text-muted">Set up your identity to get started.</p>
        <Link
          to="/onboarding"
          className="mt-6 inline-block rounded-xl bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Get started
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-accent">Contacts</h1>
        <Link
          to="/pins"
          className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-text hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          My PINs
        </Link>
        <Link
          to="/add"
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Add contact
        </Link>
      </header>

      {pins.length > 1 ? (
        <div className="mt-4 flex flex-col gap-1">
          <label htmlFor="activePin" className="text-sm font-medium">
            Active PIN
          </label>
          <select
            id="activePin"
            value={activePin ?? ""}
            onChange={(e) => usePinsStore.getState().setActivePin(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            {pins.map((p) => (
              <option key={p.pin} value={p.pin}>
                {p.label} ({p.pin})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {sortedInvites.length > 0 ? (
        <section aria-labelledby="invites-heading" className="mt-6">
          <h2 id="invites-heading" className="text-lg font-semibold">
            Pending invites
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {sortedInvites.map((i) => (
              <InviteRow key={i.inviteId} invite={i} pinLabel={labelOf(i.ownPin)} onRespond={respond} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="contacts-heading" className="mt-6">
        <h2 id="contacts-heading" className="sr-only">
          Your contacts
        </h2>
        {myContacts.length === 0 ? (
          <div className="flex flex-col items-center gap-3">
            <p className="self-start text-muted">
              No contacts yet. Add someone with their PIN, or let them scan yours:
            </p>
            {active ? <PinShareCard pin={active.pin} label={active.label} /> : null}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {myContacts.map((c) => (
              <li key={c.contactPin}>
                <ContactRow contact={c} onOpen={(pin) => openChat(c.ownPin, pin)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
