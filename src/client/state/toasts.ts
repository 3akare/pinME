import { create } from "zustand";

/** Short-lived in-app notification, optionally with a chat to open. */
export interface Toast {
  id: string;
  text: string;
  /** Opens /chat/$contactPin as ownPin. */
  chat?: { ownPin: string; contactPin: string };
}

interface ToastState {
  toasts: Toast[];
  push(toast: Omit<Toast, "id">): void;
  dismiss(id: string): void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: `t${++seq}` }].slice(-3) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
