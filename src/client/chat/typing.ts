import { create } from "zustand";
import type { Dispatcher } from "../net/dispatch";
import { conversationKey, useChatStore } from "../state/chat";
import { useContactsStore } from "../state/contacts";

/** At most one typing frame per conversation in this interval (Req 10.1). */
export const TYPING_THROTTLE_MS = 3000;
/** The indicator hides after this long without a new typing frame (Req 10.4). */
export const TYPING_HIDE_MS = 5000;

/** Injectable clock and timers. */
export interface TypingTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: TypingTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface TypingThrottle {
  /** Feeds the current input text; returns true when a typing frame should be sent now. */
  onInput(key: string, text: string, now: number): boolean;
  /** Stops typing for a conversation (e.g. after send). */
  stop(key: string): void;
}

/** Pure throttle: one frame per interval per conversation, none for empty input (Req 10.1, 10.2). */
export function createTypingThrottle(intervalMs: number = TYPING_THROTTLE_MS): TypingThrottle {
  const last = new Map<string, number>();
  return {
    onInput(key, text, now) {
      if (text.length === 0) {
        last.delete(key);
        return false;
      }
      const prev = last.get(key);
      if (prev !== undefined && now - prev < intervalMs) return false;
      last.set(key, now);
      return true;
    },
    stop(key) {
      last.delete(key);
    },
  };
}

export interface TypingVisibility {
  /** A typing frame from an accepted Contact arrived: show and restart the 5 s timer. */
  onTyping(key: string): void;
  /** A message from the Contact arrived: hide. */
  onMessage(key: string): void;
  dispose(): void;
}

/** Visibility state machine (Req 10.3-10.5). */
export function createTypingVisibility(
  setVisible: (key: string, visible: boolean) => void,
  timers: TypingTimers = realTimers,
  hideAfterMs: number = TYPING_HIDE_MS,
): TypingVisibility {
  const pending = new Map<string, unknown>();
  function clear(key: string): void {
    if (pending.has(key)) {
      timers.clearTimeout(pending.get(key));
      pending.delete(key);
    }
  }
  return {
    onTyping(key) {
      clear(key);
      setVisible(key, true);
      pending.set(
        key,
        timers.setTimeout(() => {
          pending.delete(key);
          setVisible(key, false);
        }, hideAfterMs),
      );
    },
    onMessage(key) {
      clear(key);
      setVisible(key, false);
    },
    dispose() {
      for (const key of [...pending.keys()]) clear(key);
    },
  };
}

interface TypingState {
  /** Conversation keys whose Contact is currently typing. */
  visible: Record<string, boolean>;
  /** Key of the conversation currently open in the UI, if any. */
  openKey: string | null;
  setVisible(key: string, visible: boolean): void;
  setOpen(key: string | null): void;
}

export const useTypingStore = create<TypingState>((set) => ({
  visible: {},
  openKey: null,
  setVisible: (key, visible) =>
    set((s) => {
      if (!!s.visible[key] === visible) return s;
      const { [key]: _removed, ...rest } = s.visible;
      return { visible: visible ? { ...rest, [key]: true } : rest };
    }),
  setOpen: (key) => set({ openKey: key }),
}));

export interface TypingHandlerDeps {
  ownPin: string;
  /** True when the sender is an accepted Contact. Defaults to the contacts store. */
  isContact?: (ownPin: string, from: string) => boolean;
  /** True when the conversation is open. Defaults to the typing store's open key. */
  isOpen?: (key: string) => boolean;
  setVisible?: (key: string, visible: boolean) => void;
  /** Subscribes to newly arrived incoming messages; returns unsubscribe. Defaults to the chat store. */
  subscribeIncoming?: (listener: (contactPin: string) => void) => () => void;
  timers?: TypingTimers;
}

function defaultSubscribeIncoming(ownPin: string) {
  return (listener: (contactPin: string) => void): (() => void) => {
    return useChatStore.subscribe((state, prev) => {
      for (const [key, list] of Object.entries(state.messages)) {
        if (!key.startsWith(`${ownPin}:`)) continue;
        const before = prev.messages[key];
        if (list === before) continue;
        const last = list[list.length - 1];
        if (last && last.direction === "in" && !before?.some((m) => m.messageId === last.messageId)) {
          listener(last.contactPin);
        }
      }
    });
  };
}

/** Registers the `typing` frame handler on a Dispatcher; returns an unregister function. */
export function registerTypingHandlers(dispatcher: Dispatcher, deps: TypingHandlerDeps): () => void {
  const setVisible = deps.setVisible ?? ((k, v) => useTypingStore.getState().setVisible(k, v));
  const isContact =
    deps.isContact ??
    ((own, from) =>
      useContactsStore.getState().contacts.some((c) => c.ownPin === own && c.contactPin === from));
  const isOpen = deps.isOpen ?? ((k) => useTypingStore.getState().openKey === k);
  const visibility = createTypingVisibility(setVisible, deps.timers);
  const unsubscribe = (deps.subscribeIncoming ?? defaultSubscribeIncoming(deps.ownPin))((contactPin) =>
    visibility.onMessage(conversationKey(deps.ownPin, contactPin)),
  );
  const off = dispatcher.register("typing", (msg) => {
    if (!isContact(deps.ownPin, msg.from)) return;
    const key = conversationKey(deps.ownPin, msg.from);
    if (!isOpen(key)) return;
    visibility.onTyping(key);
  });
  return () => {
    off();
    unsubscribe();
    visibility.dispose();
  };
}
