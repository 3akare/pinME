import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { MessageRecord } from "../../client/storage";

/** Within this many px of the end the list counts as "at the bottom" and follows new messages. */
export const BOTTOM_THRESHOLD_PX = 80;
/** Messages rendered at first, and added each time the reader nears the top. */
export const PAGE_SIZE = 60;
/** Loading older messages starts this close to the top. */
const TOP_LOAD_PX = 300;
/** Seen reports are batched: one per pause in scrolling, not one per frame. */
const SEEN_DEBOUNCE_MS = 250;

type Item = Pick<MessageRecord, "messageId" | "direction" | "ts" | "kind" | "text" | "sender">;

/** Counts toward unread: received chat messages, not notes about people joining or leaving. */
const isUnreadable = (m: Item) => m.direction === "in" && m.kind !== "system";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** A dialog is open: page-wide keys belong to it. */
export function dialogOpen(): boolean {
  return !!document.querySelector('[aria-modal="true"], [role="dialog"], [role="alertdialog"]');
}

export interface ConversationScrollOptions<T extends Item> {
  items: T[];
  /** Messages are loaded; the first layout after this positions the list. */
  ready: boolean;
  /** Read mark when the chat was opened: the unread divider sits after it. */
  lastReadAt: number | undefined;
  /** The reader has seen received messages up to this timestamp. */
  onSeen: (upTo: number) => void;
  /** Screen reader text for a newly arrived message. */
  describe: (item: T) => string;
}

export interface ConversationScroll<T extends Item> {
  scrollerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  /** The rendered slice: the newest messages, growing upward as the reader scrolls back. */
  visible: T[];
  /** First unread message when the chat was opened, and how many there were. Fixed while the chat is open. */
  unread: { id: string; count: number } | null;
  /** The reader is at (or near) the newest message. */
  atBottom: boolean;
  /** Received messages below what the reader has seen. */
  unseen: number;
  /** Latest screen reader announcement for arrivals. */
  announcement: string;
  onScroll: () => void;
  /** To the first message not yet seen, or to the end when there is none. */
  jumpToLatest: () => void;
}

/**
 * Scroll behaviour of a conversation, shared by one-to-one and group chats:
 * - opens at the first unread message (with a divider), or at the end;
 * - follows new messages only while the reader is at the bottom, and always after they send;
 * - never moves while the reader is looking back: counts what arrived instead;
 * - reports as seen only received messages that were actually on screen in a focused, visible tab;
 * - keeps the bottom edge in place when the pane resizes (keyboard, composer growing);
 * - renders the newest page and adds older pages near the top without the view jumping.
 */
export function useConversationScroll<T extends Item>({
  items,
  ready,
  lastReadAt,
  onSeen,
  describe,
}: ConversationScrollOptions<T>): ConversationScroll<T> {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Snapshot taken once, when the messages are first available.
  const [opened, setOpened] = useState<{ unread: { id: string; count: number } | null; startId: string | null } | null>(null);
  const [seenTs, setSeenTs] = useState(0);
  const seenRef = useRef(0);
  if (ready && opened === null) {
    const after = lastReadAt ?? 0;
    seenRef.current = after;
    setSeenTs(after);
    const firstIdx = items.findIndex((m) => isUnreadable(m) && m.ts > after);
    const count = firstIdx < 0 ? 0 : items.slice(firstIdx).filter((m) => isUnreadable(m) && m.ts > after).length;
    const start = Math.max(0, Math.min(items.length - PAGE_SIZE, firstIdx < 0 ? items.length : firstIdx - 10));
    setOpened({
      unread: firstIdx < 0 ? null : { id: items[firstIdx].messageId, count },
      startId: items[start]?.messageId ?? null,
    });
  }

  const [startId, setStartId] = useState<string | null>(null);
  const effectiveStart = startId ?? opened?.startId ?? null;
  const startIdx = effectiveStart ? Math.max(0, items.findIndex((m) => m.messageId === effectiveStart)) : 0;
  const visible = startIdx > 0 ? items.slice(startIdx) : items;

  const [atBottom, setAtBottom] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const pinned = useRef(true);
  const positioned = useRef(false);
  const lastId = useRef<string | null>(null);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const seenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const describeRef = useRef(describe);
  describeRef.current = describe;

  const toBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    pinned.current = true;
    setAtBottom(true);
    if (smooth && !prefersReducedMotion()) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  /** Puts `node` near the top of the pane. */
  const toNode = useCallback((node: Element, smooth = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    const top = el.scrollTop + node.getBoundingClientRect().top - el.getBoundingClientRect().top - 12;
    if (smooth && !prefersReducedMotion()) el.scrollTo({ top, behavior: "smooth" });
    else el.scrollTop = top;
  }, []);

  /** The newest received message whose top is inside the pane counts as seen, with everything before it. */
  const measureSeen = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || document.visibilityState !== "visible" || !document.hasFocus()) return;
    const bottom = el.getBoundingClientRect().bottom;
    const rows = el.querySelectorAll<HTMLElement>("[data-message-id]");
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.dataset.direction !== "in") continue;
      if (row.getBoundingClientRect().top > bottom - 16) continue;
      const ts = Number(row.dataset.ts);
      if (ts > seenRef.current) {
        seenRef.current = ts;
        setSeenTs(ts);
        clearTimeout(seenTimer.current);
        seenTimer.current = setTimeout(() => onSeenRef.current(seenRef.current), SEEN_DEBOUNCE_MS);
      }
      return;
    }
  }, []);

  const measureFrame = useRef(0);
  const scheduleMeasure = useCallback(() => {
    if (measureFrame.current) return;
    measureFrame.current = requestAnimationFrame(() => {
      measureFrame.current = 0;
      measureSeen();
    });
  }, [measureSeen]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
    pinned.current = near;
    setAtBottom(near);
    if (el.scrollTop < TOP_LOAD_PX && startIdx > 0 && !prepend.current) {
      prepend.current = { height: el.scrollHeight, top: el.scrollTop };
      setStartId(items[Math.max(0, startIdx - PAGE_SIZE)].messageId);
    }
    scheduleMeasure();
  }, [items, startIdx, scheduleMeasure]);

  // First layout: open at the unread divider, or at the end.
  useLayoutEffect(() => {
    if (!ready || !opened || positioned.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    positioned.current = true;
    lastId.current = items[items.length - 1]?.messageId ?? null;
    const divider = opened.unread ? el.querySelector("[data-unread-divider]") : null;
    if (divider) {
      toNode(divider);
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
      pinned.current = near;
      setAtBottom(near);
    } else {
      toBottom();
    }
    scheduleMeasure();
  });

  // Older messages were added above: keep what the reader was looking at in place.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const saved = prepend.current;
    if (!el || !saved) return;
    prepend.current = null;
    el.scrollTop = saved.top + (el.scrollHeight - saved.height);
  }, [startIdx]);

  // New messages at the end.
  useLayoutEffect(() => {
    if (!positioned.current) return;
    const last = items[items.length - 1];
    if (!last || last.messageId === lastId.current) {
      if (pinned.current) toBottom();
      return;
    }
    const prevIdx = lastId.current ? items.findIndex((m) => m.messageId === lastId.current) : -1;
    const added = items.slice(prevIdx + 1);
    lastId.current = last.messageId;
    const incoming = added.filter(isUnreadable);
    if (incoming.length > 0) setAnnouncement(describeRef.current(incoming[incoming.length - 1]));
    // Your own message always brings you to it; others only while you are already at the end.
    if (added.some((m) => m.direction === "out") || pinned.current) toBottom();
    scheduleMeasure();
  }, [items, toBottom, scheduleMeasure]);

  // Pane or content changed size (keyboard, composer growing, rotation): keep the bottom edge where it was.
  useEffect(() => {
    const el = scrollerRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    let height = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
      else if (el.clientHeight !== height) el.scrollTop += height - el.clientHeight;
      height = el.clientHeight;
      scheduleMeasure();
    });
    ro.observe(el);
    ro.observe(content);
    return () => ro.disconnect();
  }, [ready, opened, scheduleMeasure]);

  // Coming back to the tab or window counts what is on screen as seen.
  useEffect(() => {
    if (!ready) return;
    const again = () => scheduleMeasure();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, [ready, scheduleMeasure]);

  useEffect(
    () => () => {
      cancelAnimationFrame(measureFrame.current);
      // Flush a pending report so leaving the chat right after reading still counts it.
      if (seenTimer.current) {
        clearTimeout(seenTimer.current);
        onSeenRef.current(seenRef.current);
      }
    },
    [],
  );

  const firstUnseen = items.find((m) => isUnreadable(m) && m.ts > seenTs);
  const unseen = firstUnseen ? items.filter((m) => isUnreadable(m) && m.ts > seenTs).length : 0;

  const jumpToLatest = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = firstUnseen ? el.querySelector(`[data-message-id="${CSS.escape(firstUnseen.messageId)}"]`) : null;
    // A long unread run opens at its start; a short one, or none, goes to the end.
    if (target && target.getBoundingClientRect().top - el.getBoundingClientRect().top > el.clientHeight) toNode(target, true);
    else toBottom(true);
  }, [firstUnseen, toBottom, toNode]);

  // Esc goes back to the newest message, as in desktop messengers.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || dialogOpen()) return;
      toBottom(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ready, toBottom]);

  return {
    scrollerRef,
    contentRef,
    visible,
    unread: opened?.unread ?? null,
    atBottom,
    unseen,
    announcement,
    onScroll,
    jumpToLatest,
  };
}
