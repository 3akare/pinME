import { create } from "zustand";
import type { InviteRecord } from "../storage";

/** Short-lived in-app notification, optionally with a chat to open. */
export interface Toast {
  id: string;
  text: string;
  /** Opens /chat/$contactPin as ownPin. */
  chat?: { ownPin: string; contactPin: string };
  /** A toast with the same key replaces the earlier one (e.g. one per conversation). */
  key?: string;
  /** A request from someone who typed this PIN: the toast offers Accept and stays until answered. */
  invite?: InviteRecord;
}

interface ToastState {
  toasts: Toast[];
  push(toast: Omit<Toast, "id">): void;
  dismiss(id: string): void;
  dismissChat(ownPin: string, contactPin: string): void;
  dismissKey(key: string): void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) =>
    set((s) => ({
      toasts: [...s.toasts.filter((x) => !t.key || x.key !== t.key), { ...t, id: `t${++seq}` }].slice(-3),
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  dismissKey: (key) => set((s) => ({ toasts: s.toasts.filter((t) => t.key !== key) })),
  /** Drops toasts about a chat once it is open. */
  dismissChat: (ownPin, contactPin) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => !(t.chat?.ownPin === ownPin && t.chat.contactPin === contactPin)),
    })),
}));
