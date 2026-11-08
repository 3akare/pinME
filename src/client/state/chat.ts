import { create } from "zustand";
import { advance, type Marker } from "../../shared/marker";
import type { MessageRecord, Repositories } from "../storage";

export const conversationKey = (ownPin: string, contactPin: string): string =>
  `${ownPin}:${contactPin}`;

interface ChatState {
  /** Messages per conversation (key = `${ownPin}:${contactPin}`), ordered by ts. */
  messages: Record<string, MessageRecord[]>;
  setConversation(ownPin: string, contactPin: string, messages: MessageRecord[]): void;
  /** Adds a message; a message with an existing Message_ID is ignored. */
  addMessage(message: MessageRecord): void;
  /** Applies the monotonic marker reducer; unknown Message_IDs are ignored. */
  applyMarker(ownPin: string, contactPin: string, messageId: string, marker: Marker): void;
  clearConversation(ownPin: string, contactPin: string): void;
  reset(): void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: {},
  setConversation: (ownPin, contactPin, messages) =>
    set((s) => ({ messages: { ...s.messages, [conversationKey(ownPin, contactPin)]: messages } })),
  addMessage: (m) =>
    set((s) => {
      const key = conversationKey(m.ownPin, m.contactPin);
      const list = s.messages[key] ?? [];
      if (list.some((x) => x.messageId === m.messageId)) return s;
      const next = [...list, m].sort((a, b) => a.ts - b.ts);
      return { messages: { ...s.messages, [key]: next } };
    }),
  applyMarker: (ownPin, contactPin, messageId, marker) =>
    set((s) => {
      const key = conversationKey(ownPin, contactPin);
      const list = s.messages[key];
      if (!list) return s;
      const idx = list.findIndex((x) => x.messageId === messageId && x.direction === "out");
      if (idx < 0) return s;
      const cur = list[idx]!;
      const next = advance(cur.marker ?? "clock", marker);
      if (next === cur.marker) return s;
      const copy = list.slice();
      copy[idx] = { ...cur, marker: next };
      return { messages: { ...s.messages, [key]: copy } };
    }),
  clearConversation: (ownPin, contactPin) =>
    set((s) => {
      const { [conversationKey(ownPin, contactPin)]: _removed, ...rest } = s.messages;
      return { messages: rest };
    }),
  reset: () => set({ messages: {} }),
}));

/** Loads one conversation from the Local_Store into the store. */
export async function hydrateConversation(
  repos: Pick<Repositories, "messageRepo">,
  ownPin: string,
  contactPin: string,
): Promise<void> {
  const list = await repos.messageRepo.listConversation(ownPin, contactPin);
  useChatStore.getState().setConversation(ownPin, contactPin, list);
}
