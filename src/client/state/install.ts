import { create } from "zustand";

/** Chrome's install prompt event (not in the DOM typings). */
declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  }
}

interface InstallState {
  /** Present while the browser allows installing PinMe as an app. */
  prompt: BeforeInstallPromptEvent | null;
  setPrompt(prompt: BeforeInstallPromptEvent | null): void;
}

export const useInstallStore = create<InstallState>((set) => ({
  prompt: null,
  setPrompt: (prompt) => set({ prompt }),
}));
