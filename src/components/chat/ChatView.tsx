import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bootstrapApp, getLocalStore, getSession, notifyChatVisible } from "../../client/app/bootstrap";
import { sendMessage } from "../../client/chat/send";
import { createTypingThrottle, useTypingStore } from "../../client/chat/typing";
import { encrypt } from "../../client/crypto";
import { conversationKey, hydrateConversation, useChatStore } from "../../client/state/chat";
import { isConnected, useConnectionStatus, type ConnectionStatus } from "../../client/state/connection";
import { useContactsStore } from "../../client/state/contacts";
import { usePinsStore } from "../../client/state/pins";
import type { ContactRecord, MessageRecord } from "../../client/storage";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { PingButton } from "./PingButton";
import { TypingIndicator } from "./TypingIndicator";

const NO_MESSAGES: MessageRecord[] = [];
const typingThrottle = createTypingThrottle();

function subtitle(contact: ContactRecord, status: ConnectionStatus): string {
  if (contact.unavailable) return "No longer available";
  if (status !== "connected") return status === "unavailable" ? "This PIN is no longer reachable" : "Connecting…";
  if (contact.presence === "busy") return contact.personalMessage || "Busy";
  return contact.personalMessage || contact.contactPin;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** The conversation pane: header, messages grouped by day, composer. */
export function ChatView({ pin }: { pin: string }) {
  const [ready, setReady] = useState(false);
  const activePin = usePinsStore((s) => s.activePin);
  const contact = useContactsStore((s) => s.contacts.find((c) => c.ownPin === activePin && c.contactPin === pin));
  const status = useConnectionStatus(activePin);
  const key = activePin ? conversationKey(activePin, pin) : "";
  const messages = useChatStore((s) => s.messages[key] ?? NO_MESSAGES);
  const typingVisible = useTypingStore((s) => !!s.visible[key]);
  const scroller = useRef<HTMLDivElement>(null);

  // The contact may belong to another own PIN (opened from a link or a toast): switch to it.
  useEffect(() => {
    let cancelled = false;
    void bootstrapApp().then(async () => {
      const pins = usePinsStore.getState();
      const contacts = useContactsStore.getState().contacts;
      if (!contacts.some((c) => c.ownPin === pins.activePin && c.contactPin === pin)) {
        const owner = contacts.find((c) => c.contactPin === pin)?.ownPin;
        if (owner) pins.setActivePin(owner);
      }
      const own = usePinsStore.getState().activePin;
      if (own) await hydrateConversation(await getLocalStore(), own, pin).catch(() => {});
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pin]);

  useEffect(() => {
    if (!key) return;
    useTypingStore.getState().setOpen(key);
    return () => {
      if (useTypingStore.getState().openKey === key) useTypingStore.getState().setOpen(null);
      useTypingStore.getState().setVisible(key, false);
    };
  }, [key]);

  // Read receipts and the unread count follow what is actually on screen.
  useEffect(() => {
    if (!ready || !activePin) return;
    const own = activePin;
    const markRead = () => {
      if (document.visibilityState === "visible") notifyChatVisible(own, pin);
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [ready, activePin, pin, messages.length]);

  // Stay pinned to the newest message unless the reader scrolled up to look back.
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, typingVisible, ready]);

  const groups = useMemo(() => {
    const out: { day: string; items: MessageRecord[] }[] = [];
    for (const m of messages) {
      const day = dayLabel(m.ts);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [messages]);

  function onTypingInput(text: string): void {
    if (!activePin) return;
    if (!typingThrottle.onInput(key, text, Date.now())) return;
    getSession(activePin)?.send(JSON.stringify({ type: "typing", to: pin }));
  }

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p role="status" aria-live="polite" className="text-muted">
          Opening chat…
        </p>
      </div>
    );
  }
  if (!activePin || !contact) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-2xl">Chat not found</h1>
        <p className="text-muted">There is no contact with that PIN.</p>
        <Link to="/" className="btn btn--quiet">
          Back to chats
        </Link>
      </div>
    );
  }

  const own = activePin;
  async function onSend(text: string): Promise<boolean> {
    const res = await sendMessage(
      {
        repos: await getLocalStore(),
        store: useChatStore.getState(),
        encrypt,
        send: (d) => getSession(own)?.send(d) ?? false,
        isConnected: () => isConnected(own),
      },
      { ownPin: own, contactPin: pin, text },
    );
    if (res.ok) pinned.current = true;
    return res.ok;
  }

  return (
    <section aria-label={`Chat with ${contact.displayName}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-rule px-3 sm:px-5">
        <Link to="/" aria-label="Back" className="icon-btn md:hidden">
          <Icon name="back" />
        </Link>
        <Avatar name={contact.displayName} picture={contact.picture} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-display text-xl leading-tight">{contact.displayName}</h1>
          {typingVisible ? (
            <TypingIndicator name={contact.displayName} visible />
          ) : (
            <p className="truncate text-sm text-muted">{subtitle(contact, status)}</p>
          )}
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="pane-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
      >
        <div role="log" aria-label="Conversation" className="mx-auto flex max-w-3xl flex-col gap-1.5">
          {groups.length === 0 ? (
            <p className="py-16 text-center text-muted">
              Say hello to {contact.displayName}. Messages are encrypted on this device before they leave it.
            </p>
          ) : null}
          {groups.map((g) => (
            <div key={g.day} className="flex flex-col gap-1.5">
              <p className="my-3 self-center rounded-pill bg-paper-2 px-3 py-1 text-xs text-muted">{g.day}</p>
              {g.items.map((m) => (
                <MessageBubble
                  key={m.messageId}
                  direction={m.direction}
                  text={m.text}
                  ts={m.ts}
                  pending={m.pending}
                  failed={m.failed}
                  marker={m.direction === "out" ? (m.marker ?? "clock") : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {contact.unavailable ? (
        <p role="status" className="border-t border-rule px-5 py-4 text-center text-muted">
          This contact is unavailable.
        </p>
      ) : (
        <MessageInput
          onSend={onSend}
          onChange={onTypingInput}
          connected={status === "connected"}
          pingSlot={
            <PingButton
              to={pin}
              send={(d) => getSession(own)?.send(d)}
              dispatcher={getSession(own)?.dispatcher}
              disabled={status !== "connected"}
            />
          }
        />
      )}
    </section>
  );
}
