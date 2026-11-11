import type { LocalStore } from "./index";
/**
 * Removes one burned PIN's keys, contacts, invites and conversations from the
 * Local_Store in a single transaction (Req 13.8). Other PINs are untouched.
 * If the transaction fails nothing is removed and the error propagates.
 */
export async function cleanupBurnedPin(store: Pick<LocalStore, "purgePin">, pin: string): Promise<void> {
  await store.purgePin(pin);
  dropDrafts(pin);
}

/** Unsent composer drafts of the burned PIN's conversations (kept in session storage) go too. */
function dropDrafts(pin: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    const prefix = `pinme:draft:${pin}:`;
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(prefix)) sessionStorage.removeItem(k);
    }
  } catch {
    // storage blocked: nothing was saved
  }
}
