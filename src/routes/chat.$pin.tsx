import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { bootstrapApp, getLocalStore, getSession, notifyChatVisible } from "../client/app/bootstrap";
import { sendMessage } from "../client/chat/send";
import { encrypt } from "../client/crypto";
import { useChatStore, conversationKey, hydrateConversation } from "../client/state/chat";
import { isConnected, useConnectionStatus } from "../client/state/connection";
import { useContactsStore } from "../client/state/contacts";
import { usePinsStore } from "../client/state/pins";
import { MessageBubble } from "../components/chat/MessageBubble";
import { MessageInput } from "../components/chat/MessageInput";
import { PingButton } from "../components/chat/PingButton";
import { useShakeStore } from "../client/net/handlers/ping";
import { TypingIndicator } from "../components/chat/TypingIndicator";
import { createTypingThrottle, useTypingStore } from "../client/chat/typing";
import type { MessageRecord } from "../client/storage";

export const Route = createFileRoute("/chat/$pin")({
  component: Chat,
});

const NO_MESSAGES: MessageRecord[] = [];
const typingThrottle = createTypingThrottle();

export function NotFoundPanel() {
  return (
    <main className="mx-auto max-w-md p-6">
      <section role="alert" className="rounded-2xl border border-border bg-surface p-4">
        <h1 className="text-xl font-bold text-text">Chat not found</h1>
        <p className="mt-1 text-muted">There is no contact with that PIN.</p>
        <Link
          to="/"
          className="mt-4 inline-block rounded-xl bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Back to home
        </Link>
      </section>
    </main>
  );
}

function Chat() {
  const { pin } = Route.useParams();
  const [ready, setReady] = useState(false);
  const activePin = usePinsStore((s) => s.activePin);
  const contact = useContactsStore((s) => s.contacts.find((c) => c.ownPin === activePin && c.contactPin === pin));
  const status = useConnectionStatus(activePin);
  const key = activePin ? conversationKey(activePin, pin) : "";
  const messages = useChatStore((s) => s.messages[key] ?? NO_MESSAGES);

  useEffect(() => {
    let cancelled = false;
    void bootstrapApp().then(async () => {
      const own = usePinsStore.getState().activePin;
      if (own) await hydrateConversation(await getLocalStore(), own, pin).catch(() => {});
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pin]);

  const shaking = useShakeStore((s) => s.shaking);
  const typingVisible = useTypingStore((s) => !!s.visible[key]);
  useEffect(() => {
    if (!key) return;
    useTypingStore.getState().setOpen(key);
    return () => {
      if (useTypingStore.getState().openKey === key) useTypingStore.getState().setOpen(null);
      useTypingStore.getState().setVisible(key, false);
    };
  }, [key]);

  // Send `read` for messages that arrived while this chat was closed or the tab was hidden.
  useEffect(() => {
    if (!ready || !activePin) return;
    const own = activePin;
    const markRead = () => {
      if (document.visibilityState === "visible") notifyChatVisible(own, pin);
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [ready, activePin, pin]);
  function onTypingInput(text: string): void {
    if (!activePin) return;
    if (!typingThrottle.onInput(key, text, Date.now())) return;
    getSession(activePin)?.send(JSON.stringify({ type: "typing", to: pin }));
  }
  if (!ready) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p role="status" aria-live="polite" className="text-muted">
          Loading...
        </p>
      </main>
    );
  }
  if (!activePin || !contact) return <NotFoundPanel />;

  const unavailable = !!contact.unavailable;

  async function onSend(text: string): Promise<boolean> {
    if (!activePin) return false;
    const session = getSession(activePin);
    if (!session) return false;
    const repos = await getLocalStore();
    const res = await sendMessage(
      {
        repos,
        store: useChatStore.getState(),
        encrypt,
        send: (d) => session.send(d),
        isConnected: () => isConnected(activePin),
      },
      { ownPin: activePin, contactPin: pin, text },
    );
    return res.ok;
  }

  return (
    <main
      className={`mx-auto flex h-dvh w-full max-w-2xl flex-col p-3 sm:p-4${shaking ? " pinme-shake" : ""}`}
    >
      <header className="flex items-center gap-3 pb-3">
        <Link
          to="/"
          className="rounded-xl border border-border px-3 py-1 text-sm hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          Back
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-text">{contact.displayName}</h1>
      </header>
      <section
        aria-label="Conversation"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden"
      >
        {messages.map((m) => (
          <MessageBubble
            key={m.messageId}
            direction={m.direction}
            text={m.text}
            marker={m.direction === "out" ? (m.marker ?? "clock") : undefined}
          />
        ))}
      </section>
      <TypingIndicator name={contact.displayName} visible={typingVisible} />
      {unavailable ? (
        <p role="status" className="py-3 text-muted">
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
              send={(d) => getSession(activePin)?.send(d)}
              dispatcher={getSession(activePin)?.dispatcher}
              disabled={status !== "connected"}
            />
          }
        />
      )}
    </main>
  );
}
