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
      <main className="mx-auto max-w-md p-6">
        <p role="status" aria-live="polite" className="text-muted">
          Loading...
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3 sm:p-4">
      <header className="flex items-center gap-3">
        <Link
          to="/"
          className="rounded-xl border border-border px-3 py-1 text-sm hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          Back
        </Link>
        <h1 className="text-lg font-bold text-text">Broadcast</h1>
      </header>
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor="broadcast-text" className="text-sm text-muted">
          Message to all contacts of this PIN
        </label>
        <textarea
          id="broadcast-text"
          value={text}
          maxLength={MAX_PLAINTEXT_CHARS}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="rounded-xl border border-border bg-surface p-2 text-text"
        />
        {error ? (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={status !== "connected" || text.length === 0 || mine.length === 0}
          className="self-end rounded-xl bg-accent px-4 py-2 font-semibold text-on-accent disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Send to all
        </button>
      </form>
      {mine.length === 0 ? (
        <p role="status" className="text-muted">
          This PIN has no contacts yet.
        </p>
      ) : (
        <ul aria-label="Recipients" className="flex flex-col gap-2">
          {mine.map((c) => {
            const marker = markerFor(c.contactPin);
            return (
              <li
                key={c.contactPin}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-text">{c.displayName}</span>
                {failed.has(c.contactPin) ? (
                  <span role="status" className="text-xs text-red-400">
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
    </main>
  );
}
