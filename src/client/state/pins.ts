import { create } from "zustand";
import type { PinRecord } from "../storage";

interface PinsState {
  pins: PinRecord[];
  activePin: string | null;
  setPins(pins: PinRecord[]): void;
  addPin(pin: PinRecord): void;
  removePin(pin: string): void;
  /** Selects an existing PIN; ignored when the PIN is unknown. */
  setActivePin(pin: string): void;
}

export const usePinsStore = create<PinsState>((set) => ({
  pins: [],
  activePin: null,
  setPins: (pins) =>
    set((s) => ({
      pins,
      activePin:
        s.activePin && pins.some((p) => p.pin === s.activePin) ? s.activePin : (pins[0]?.pin ?? null),
    })),
  addPin: (pin) =>
    set((s) => ({
      pins: [...s.pins.filter((p) => p.pin !== pin.pin), pin],
      activePin: s.activePin ?? pin.pin,
    })),
  removePin: (pin) =>
    set((s) => {
      const pins = s.pins.filter((p) => p.pin !== pin);
      return { pins, activePin: s.activePin === pin ? (pins[0]?.pin ?? null) : s.activePin };
    }),
  setActivePin: (pin) =>
    set((s) => (s.pins.some((p) => p.pin === pin) ? { activePin: pin } : s)),
}));
