import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { bootstrapApp, getLocalStore, groupActions, notifyChatVisible } from "../../client/app/bootstrap";
import { useTypingStore } from "../../client/chat/typing";
import { conversationKey, hydrateConversation, useChatStore } from "../../client/state/chat";
import { useConnectionStatus } from "../../client/state/connection";
import { useGroupsStore } from "../../client/state/groups";
import { usePinsStore } from "../../client/state/pins";
import { groupKey, type MessageRecord } from "../../client/storage";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { ArrivalAnnouncer, JumpToLatest, UnreadDivider } from "./ConversationParts";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { useConversationScroll } from "./useConversationScroll";

const NO_MESSAGES: MessageRecord[] = [];

/** A group conversation: who wrote each message, notes when people join or leave, and Leave. */
export function GroupView({ groupId }: { groupId: string }) {
  const navigate = useNavigate();
  const activePin = usePinsStore((s) => s.activePin);
  const group = useGroupsStore((s) => s.groups.find((g) => g.groupId === groupId && g.ownPin === activePin));
  const status = useConnectionStatus(activePin);
  const key = activePin ? conversationKey(activePin, groupKey(groupId)) : "";
  const messages = useChatStore((s) => s.messages[key] ?? NO_MESSAGES);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState<"ask" | "busy" | null>(null);
  const [error, setError] = useState<string | undefined>();

  // A group belongs to one own PIN; open it under that PIN.
  useEffect(() => {
    let cancelled = false;
    void bootstrapApp().then(async () => {
      const pins = usePinsStore.getState();
      const owner = useGroupsStore.getState().groups.find((g) => g.groupId === groupId)?.ownPin;
      if (owner && owner !== pins.activePin) pins.setActivePin(owner);
      const own = usePinsStore.getState().activePin;
      if (own) await hydrateConversation(await getLocalStore(), own, groupKey(groupId)).catch(() => {});
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  useEffect(() => {
    if (!key) return;
    useTypingStore.getState().setOpen(key);
    return () => {
      if (useTypingStore.getState().openKey === key) useTypingStore.getState().setOpen(null);
    };
  }, [key]);

  // Opening the group clears its toasts; the unread count follows what is actually on screen.
  useEffect(() => {
    if (ready && activePin) notifyChatVisible(activePin, groupKey(groupId), 0);
  }, [ready, activePin, groupId]);

  const senderName = (pin?: string) => group?.members.find((m) => m.pin === pin)?.displayName ?? pin ?? "";
  const view = useConversationScroll({
    items: messages,
    ready: ready && !!group,
    lastReadAt: group?.lastReadAt,
    onSeen: (upTo) => {
      if (activePin) notifyChatVisible(activePin, groupKey(groupId), upTo);
    },
    describe: (m) => `${senderName(m.sender)}: ${m.text.length > 140 ? `${m.text.slice(0, 140)}…` : m.text}`,
  });

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p role="status" className="text-muted">
          Opening group…
        </p>
      </div>
    );
  }
  if (!activePin || !group) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-2xl">Group not found</h1>
        <p className="text-muted">You may have left it, or it belongs to a PIN you burned.</p>
        <Link to="/" className="btn btn--quiet">
          Back to chats
        </Link>
      </div>
    );
  }

  const own = activePin;

  async function leave() {
    setLeaving("busy");
    setError(undefined);
    const res = await (await groupActions()).leave(own, groupId);
    if (res.ok) {
      void navigate({ to: "/" });
      return;
    }
    setLeaving("ask");
    setError(res.code === "disconnected" ? "You are offline. Try again when connected." : "Could not leave. Try again.");
  }

  return (
    <section aria-label={`Group ${group.name}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-rule px-3 sm:px-5">
        <Link to="/" aria-label="Back" className="icon-btn md:hidden">
          <Icon name="back" />
        </Link>
        <Avatar name={group.name} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-display text-xl leading-tight">{group.name}</h1>
          <p className="truncate text-sm text-muted">
            {["You", ...group.members.map((m) => m.displayName)].join(", ")}
          </p>
        </div>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setLeaving("ask")}>
          Leave
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={view.scrollerRef}
          onScroll={view.onScroll}
          tabIndex={0}
          aria-label="Messages"
          className="pane-scroll chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 focus-visible:outline-offset-[-2px] sm:px-6"
        >
          <div ref={view.contentRef} role="log" aria-live="off" aria-label="Conversation" className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {view.visible.map((m) => (
              <div key={m.messageId} className="contents">
                {view.unread?.id === m.messageId ? <UnreadDivider count={view.unread.count} /> : null}
                {m.kind === "system" ? (
                  <p
                    data-message-id={m.messageId}
                    data-direction={m.direction}
                    data-ts={m.ts}
                    className="my-2 self-center rounded-pill bg-paper-2 px-3 py-1 text-center text-xs text-muted"
                  >
                    {m.text}
                  </p>
                ) : (
                  <div
                    data-message-id={m.messageId}
                    data-direction={m.direction}
                    data-ts={m.ts}
                    className={`flex flex-col ${m.direction === "out" ? "items-end" : "items-start"}`}
                  >
                    {m.direction === "in" ? <span className="mb-0.5 ml-3 text-xs text-accent">{senderName(m.sender)}</span> : null}
                    <MessageBubble direction={m.direction} text={m.text} ts={m.ts} pending={m.pending} failed={m.failed} showMarker={false} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {!view.atBottom ? <JumpToLatest unseen={view.unseen} onJump={view.jumpToLatest} /> : null}
        <ArrivalAnnouncer text={view.announcement} />
      </div>

      <MessageInput
        draftKey={key}
        connected={status === "connected"}
        onSend={async (text) => (await (await groupActions()).send(own, groupId, text)).ok}
      />

      {leaving ? (
        <Modal labelledBy="leave-title" describedBy="leave-desc" onDismiss={leaving === "busy" ? undefined : () => setLeaving(null)}>
          <h2 id="leave-title" className="font-display text-2xl">
            Leave {group.name}?
          </h2>
          <p id="leave-desc" className="mt-3 text-ink-2">
            The others are told you left, and this group and its messages are removed from this device.
          </p>
          <p role="alert" className="mt-2 min-h-5 text-sm text-error">
            {error}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn btn--quiet btn--sm" disabled={leaving === "busy"} onClick={() => setLeaving(null)}>
              Stay
            </button>
            <button type="button" className="btn btn--primary btn--sm" disabled={leaving === "busy"} onClick={() => void leave()}>
              {leaving === "busy" ? "Leaving…" : "Leave group"}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
