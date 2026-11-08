import { create } from "zustand";
import { useContactsStore } from "../../state/contacts";
import type { Dispatcher } from "../dispatch";

/** Shake window length (Req 9.2). */
export const SHAKE_MS = 1000;
/** Vibration length where supported (Req 9.3). */
export const VIBRATE_MS = 500;

/** True while the chat window should shake. */
export const useShakeStore = create<{ shaking: boolean; setShaking(v: boolean): void }>((set) => ({
  shaking: false,
  setShaking: (shaking) => set({ shaking }),
}));

let sharedCtx: AudioContext | null = null;

/** Plays a short ping tone once, generated with a WebAudio oscillator (no binary asset). */
export function playPingSound(): void {
  try {
    const Ctor: typeof AudioContext | undefined =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    sharedCtx ??= new Ctor();
    const ctx = sharedCtx;
    void ctx.resume?.();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(660, t + 0.15);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  } catch {
    // Audio may be blocked by autoplay policy; the shake still happens.
  }
}

export interface PingHandlerDeps {
  ownPin: string;
  /** True when the sender is an accepted Contact. Defaults to the contacts store. */
  isContact?: (ownPin: string, from: string) => boolean;
  /** Plays the sound once. Defaults to the WebAudio tone. */
  playSound?: () => void;
  /** Vibrates for `ms`. Defaults to navigator.vibrate when it exists. */
  vibrate?: (ms: number) => void;
  /** Starts the shake and returns a function that stops it. Defaults to the shake store. */
  shake?: (active: boolean) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

function defaultVibrate(ms: number): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
}

/** Registers the `ping` frame handler (Req 9.2, 9.3); returns an unregister function. */
export function registerPingHandlers(dispatcher: Dispatcher, deps: PingHandlerDeps): () => void {
  const isContact =
    deps.isContact ??
    ((own, from) =>
      useContactsStore.getState().contacts.some((c) => c.ownPin === own && c.contactPin === from));
  const playSound = deps.playSound ?? playPingSound;
  const vibrate = deps.vibrate ?? defaultVibrate;
  const shake = deps.shake ?? ((v: boolean) => useShakeStore.getState().setShaking(v));
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;

  const off = dispatcher.register("ping", (msg) => {
    if (!isContact(deps.ownPin, msg.from)) return;
    if (timer !== null) clearT(timer);
    shake(true);
    timer = setT(() => {
      timer = null;
      shake(false);
    }, SHAKE_MS);
    playSound();
    vibrate(VIBRATE_MS);
  });
  return () => {
    off();
    if (timer !== null) clearT(timer);
    timer = null;
    shake(false);
  };
}
