import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { bootstrapApp, getLocalStore, getSession } from "../client/app/bootstrap";
import { sendBroadcast } from "../client/chat/broadcast";
import { encrypt } from "../client/crypto";
import { useChatStore, conversationKey, hydrateConversation } from "../client/state/chat";
import { isConnected, useConnectionStatus } from "../client/state/connection";
import { useContactsStore } from "../client/state/contacts";
import { usePinsStore } from "../client/state/pins";
import { DeliveryMarker } from "../components/chat/MessageBubble";
import { Avatar } from "../components/ui/Avatar";
import { Icon } from "../components/ui/Icon";
import { MAX_PLAINTEXT_CHARS } from "../shared/limits";
import type { MessageRecord } from "../client/storage";

export const Route = createFileRoute("/broadcast")({
  component: Broadcast,
});

const NO_MESSAGES: MessageRecord[] = [];

function Broadcast() {
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** contactPin -> Message_ID of the latest broadcast sent to them. */
  const [sent, setSent] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const activePin = usePinsStore((s) => s.activePin);
  const contacts = useContactsStore((s) => s.contacts);
  const status = useConnectionStatus(activePin);
  const messages = useChatStore((s) => s.messages);

  const mine = useMemo(
    () => contacts.filter((c) => c.ownPin === activePin && !c.unavailable),
    [contacts, activePin],
  );

  useEffect(() => {
    let cancelled = false;
    void bootstrapApp().then(async () => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-envelope server errors (carry `to`) mark that recipient as failed.
  useEffect(() => {
    if (!ready || !activePin) return;
    const session = getSession(activePin);
    if (!session) return;
    // listen(), not register(): other screens observe error frames on the same session.
    return session.dispatcher.listen("error", (msg) => {
      const to = msg.to;
      if (to) setFailed((prev) => new Set(prev).add(to));
    });
  }, [ready, activePin]);

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper">
        <p role="status" aria-live="polite" className="text-muted">
          Loading…
        </p>
      </main>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!activePin) return;
    const session = getSession(activePin);
    if (!session) {
      setError("Not connected.");
      return;
    }
    const repos = await getLocalStore();
    const res = await sendBroadcast(
      {
        repos,
        store: useChatStore.getState(),
        encrypt,
        send: (d) => session.send(d),
        isConnected: () => isConnected(activePin),
      },
      { ownPin: activePin, text },
    );
    if (!res.ok) {
      setError(
        res.code === "no_recipients"
          ? "This PIN has no contacts to broadcast to."
          : res.code === "invalid_text"
            ? `Enter 1 to ${MAX_PLAINTEXT_CHARS} characters.`
            : "Could not send the broadcast.",
      );
      return;
    }
    setFailed(new Set(res.failed));
    setSent(Object.fromEntries(res.sent.map((s) => [s.contactPin, s.messageId])));
    for (const s of res.sent) await hydrateConversation(repos, activePin, s.contactPin).catch(() => {});
    setText("");
  }

  function markerFor(contactPin: string) {
    const id = sent[contactPin];
    if (!activePin || !id) return null;
    const m = (messages[conversationKey(activePin, contactPin)] ?? NO_MESSAGES).find(
      (x) => x.messageId === id,
    );
    return m?.marker ?? "clock";
  }

  const active = usePinsStore.getState().pins.find((p) => p.pin === activePin);

  return (
    <main className="min-h-dvh bg-paper">
      <header className="flex h-16 items-center gap-3 border-b border-rule px-3 sm:px-5">
        <Link to="/" aria-label="Back" className="icon-btn">
          <Icon name="back" />
        </Link>
        <h1 className="font-display text-2xl">Broadcast</h1>
      </header>
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label htmlFor="broadcast-text" className="text-ink-2">
            One message to every contact of your {active?.label ?? "current"} PIN. Each gets their own encrypted copy.
          </label>
          <textarea
            id="broadcast-text"
            value={text}
            maxLength={MAX_PLAINTEXT_CHARS}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="field min-h-32 resize-y py-3"
          />
          {error ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={status !== "connected" || text.length === 0 || mine.length === 0}
            className="btn btn--primary self-end"
          >
            Send to all
          </button>
        </form>
        {mine.length === 0 ? (
          <p role="status" className="text-muted">
            This PIN has no contacts yet.
          </p>
        ) : (
          <ul aria-label="Recipients" className="border-t border-rule">
            {mine.map((c) => {
              const marker = markerFor(c.contactPin);
              return (
                <li key={c.contactPin} className="flex items-center gap-3 border-b border-rule px-1 py-3">
                  <Avatar name={c.displayName} picture={c.picture} size={36} />
                  <span className="min-w-0 flex-1 truncate text-ink">{c.displayName}</span>
                  {failed.has(c.contactPin) ? (
                    <span role="status" className="text-sm text-error">
                      Failed
                    </span>
                  ) : marker ? (
                    <DeliveryMarker marker={marker} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
