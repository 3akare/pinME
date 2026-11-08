import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { getLocalStore, getSession } from "../../client/app/bootstrap";
import { conversationKey, hydrateConversation, useChatStore } from "../../client/state/chat";
import { useConnectionStatus } from "../../client/state/connection";
import { useContactsStore } from "../../client/state/contacts";
import { useIdentityStore } from "../../client/state/identity";
import { usePinsStore } from "../../client/state/pins";
import type { MessageRecord } from "../../client/storage";
import { InstallItem, NotificationsItem } from "../app/AppMenuItems";
import { InviteRow } from "../invites/InviteRow";
import { useInviteResponder } from "../invites/useInviteResponder";
import { PinShareCard } from "../pins/PinShareCard";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { ContactRow } from "./ContactRow";

export interface ChatListProps {
  /** Contact PIN of the chat open beside the list, if any. */
  selected?: string;
  onScan: () => void;
  onMyCode: () => void;
  onBackup: () => void;
}

/** The left pane: who you are, how to connect, requests, and every chat of the active PIN. */
export function ChatList({ selected, onScan, onMyCode, onBackup }: ChatListProps) {
  const navigate = useNavigate();
  const identity = useIdentityStore((s) => s.identity);
  const pins = usePinsStore((s) => s.pins);
  const activePin = usePinsStore((s) => s.activePin);
  const contacts = useContactsStore((s) => s.contacts);
  const invites = useContactsStore((s) => s.pendingInvites);
  const messages = useChatStore((s) => s.messages);
  const status = useConnectionStatus(activePin);
  const respond = useInviteResponder();
  const active = pins.find((p) => p.pin === activePin);
  const activePins = pins.filter((p) => p.status === "active");

  const mine = useMemo(() => contacts.filter((c) => c.ownPin === activePin), [contacts, activePin]);

  // Load each conversation once so rows can show the last message and the unread count.
  useEffect(() => {
    if (!activePin) return;
    void getLocalStore().then((store) =>
      Promise.all(mine.map((c) => hydrateConversation(store, activePin, c.contactPin))).catch(() => {}),
    );
    // Only when the set of chats changes, not on every message.
  }, [activePin, mine.length]);

  const rows = useMemo(() => {
    return mine
      .map((c) => {
        const list: MessageRecord[] = messages[conversationKey(c.ownPin, c.contactPin)] ?? [];
        const last = list[list.length - 1];
        const unread = list.filter((m) => m.direction === "in" && m.ts > (c.lastReadAt ?? 0)).length;
        return { c, last, unread };
      })
      .sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0) || a.c.displayName.localeCompare(b.c.displayName));
  }, [mine, messages]);

  const sortedInvites = useMemo(() => [...invites].sort((a, b) => a.createdAt - b.createdAt), [invites]);
  const labelOf = (pin: string) => (activePins.length > 1 ? pins.find((p) => p.pin === pin)?.label : undefined);

  const openChat = (ownPin: string, pin: string) => {
    usePinsStore.getState().setActivePin(ownPin);
    void navigate({ to: "/chat/$pin", params: { pin } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4">
        <Avatar name={identity?.displayName ?? "?"} picture={identity?.picture} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-display text-xl leading-tight">Chats</h1>
          {activePins.length > 1 ? (
            <>
              <label htmlFor="activePin" className="visually-hidden">
                Active PIN
              </label>
              <select
                id="activePin"
                value={activePin ?? ""}
                onChange={(e) => usePinsStore.getState().setActivePin(e.target.value)}
                className="-ml-1 max-w-full cursor-pointer truncate rounded-pill bg-transparent px-1 text-sm text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
              >
                {activePins.map((p) => (
                  <option key={p.pin} value={p.pin}>
                    {p.label} ({p.pin})
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className="truncate text-sm text-muted">
              {active?.label} PIN <span className="[font-variant-numeric:lining-nums_tabular-nums]">{active?.pin}</span>
            </p>
          )}
        </div>
        <button type="button" onClick={onScan} aria-label="Scan a code" title="Scan a code" className="icon-btn">
          <Icon name="scan" />
        </button>
        <button type="button" onClick={onMyCode} aria-label="My code" title="My code" className="icon-btn">
          <Icon name="qr" />
        </button>
        <MoreMenu onBackup={onBackup} />
      </header>

      {status !== "connected" && activePin ? (
        <div role="status" className="mx-4 mb-2 flex items-center gap-3 rounded-card bg-paper-2 px-3 py-2 text-sm text-ink-2">
          <span className="flex-1">
            {status === "unavailable" ? "This PIN can no longer be reached." : "Connecting. Messages you write go out once it is back."}
          </span>
          {status !== "unavailable" ? (
            <button type="button" className="link text-sm" onClick={() => getSession(activePin)?.reconnect()}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="pane-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {sortedInvites.length > 0 ? (
          <section aria-labelledby="requests-heading" className="mb-3 px-2">
            <h2 id="requests-heading" className="mb-2 px-1 font-body text-sm font-medium text-muted">
              Requests
            </h2>
            <ul className="flex flex-col gap-2">
              {sortedInvites.map((i) => (
                <InviteRow key={i.inviteId} invite={i} pinLabel={labelOf(i.ownPin)} onRespond={respond} />
              ))}
            </ul>
          </section>
        ) : null}

        {rows.length === 0 ? (
          <section aria-labelledby="start-heading" className="flex flex-col items-center gap-4 px-4 pt-6 text-center">
            <h2 id="start-heading" className="font-display text-2xl">
              Start a chat
            </h2>
            <p className="text-muted">Let someone scan your code, or scan theirs. You are connected the moment they do.</p>
            {active ? <PinShareCard pin={active.pin} /> : null}
            <button type="button" className="btn btn--quiet" onClick={onScan}>
              <Icon name="scan" /> Scan their code
            </button>
          </section>
        ) : (
          <ul aria-label="Chats" className="flex flex-col">
            {rows.map(({ c, last, unread }) => (
              <li key={c.contactPin}>
                <ContactRow
                  contact={c}
                  last={last}
                  unread={unread}
                  selected={selected === c.contactPin}
                  onOpen={(pin) => openChat(c.ownPin, pin)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Less frequent destinations behind one button. */
function MoreMenu({ onBackup }: { onBackup: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item =
    "flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-ink no-underline hover:bg-paper-3 focus-visible:outline-2 focus-visible:outline-focus";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More"
        aria-expanded={open}
        aria-controls="more-menu"
        onClick={() => setOpen((v) => !v)}
        className="icon-btn"
      >
        <Icon name="more" />
      </button>
      {open ? (
        <div id="more-menu" className="absolute right-0 top-full z-[100] mt-1 w-64 rounded-card bg-paper-2 p-1.5 shadow-card">
          <Link to="/pins" className={item}>
            <Icon name="pins" /> My PINs
          </Link>
          <Link to="/broadcast" className={item}>
            <Icon name="broadcast" /> Broadcast
          </Link>
          <button
            type="button"
            className={`${item} w-full text-left`}
            onClick={() => {
              setOpen(false);
              onBackup();
            }}
          >
            <Icon name="install" className="h-5 w-5 rotate-180" /> Back up
          </button>
          <NotificationsItem />
          <InstallItem />
        </div>
      ) : null}
    </div>
  );
}
