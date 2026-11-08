import { create } from "zustand";
import type { IdentityRecord } from "../storage";

interface IdentityState {
  identity: IdentityRecord | null;
  /** True once the Local_Store has been read at least once. */
  loaded: boolean;
  setIdentity(identity: IdentityRecord | null): void;
  setLoaded(identity: IdentityRecord | null): void;
}

export const useIdentityStore = create<IdentityState>((set) => ({
  identity: null,
  loaded: false,
  setIdentity: (identity) => set({ identity }),
  setLoaded: (identity) => set({ identity, loaded: true }),
}));
