import { create } from "zustand";
import type { ContactRecord, InviteRecord, Repositories } from "../storage";

interface ContactsState {
  contacts: ContactRecord[];
  pendingInvites: InviteRecord[];
  setAll(contacts: ContactRecord[], invites: InviteRecord[]): void;
  upsertContact(contact: ContactRecord): void;
  addInvite(invite: InviteRecord): void;
  removeInvite(inviteId: string): void;
}

export const useContactsStore = create<ContactsState>((set) => ({
  contacts: [],
  pendingInvites: [],
  setAll: (contacts, pendingInvites) => set({ contacts, pendingInvites }),
  upsertContact: (c) =>
    set((s) => ({
      contacts: [
        ...s.contacts.filter((x) => !(x.ownPin === c.ownPin && x.contactPin === c.contactPin)),
        c,
      ],
    })),
  addInvite: (i) =>
    set((s) => ({
      pendingInvites: [...s.pendingInvites.filter((x) => x.inviteId !== i.inviteId), i],
    })),
  removeInvite: (inviteId) =>
    set((s) => ({ pendingInvites: s.pendingInvites.filter((x) => x.inviteId !== inviteId) })),
}));

/** Loads contacts and pending invites for the given own PINs from the Local_Store. */
export async function hydrateContacts(
  repos: Pick<Repositories, "contactRepo" | "inviteRepo">,
  ownPins: readonly string[],
): Promise<void> {
  const contacts: ContactRecord[] = [];
  const invites: InviteRecord[] = [];
  for (const pin of ownPins) {
    contacts.push(...(await repos.contactRepo.listForPin(pin)));
    invites.push(...(await repos.inviteRepo.listForPin(pin)));
  }
  useContactsStore.getState().setAll(contacts, invites);
}
