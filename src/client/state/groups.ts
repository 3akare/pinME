import { create } from "zustand";
import type { GroupRecord, Repositories } from "../storage";

interface GroupsState {
  groups: GroupRecord[];
  setAll(groups: GroupRecord[]): void;
  upsert(group: GroupRecord): void;
  remove(ownPin: string, groupId: string): void;
}

export const useGroupsStore = create<GroupsState>((set) => ({
  groups: [],
  setAll: (groups) => set({ groups }),
  upsert: (g) =>
    set((s) => ({ groups: [...s.groups.filter((x) => !(x.ownPin === g.ownPin && x.groupId === g.groupId)), g] })),
  remove: (ownPin, groupId) =>
    set((s) => ({ groups: s.groups.filter((x) => !(x.ownPin === ownPin && x.groupId === groupId)) })),
}));

export async function hydrateGroups(repos: Pick<Repositories, "groupRepo">, ownPins: readonly string[]): Promise<void> {
  const all = [];
  for (const pin of ownPins) all.push(...(await repos.groupRepo.listForPin(pin)));
  useGroupsStore.getState().setAll(all);
}
