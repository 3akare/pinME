import type { LocalStore } from "./index";
/**
 * Removes one burned PIN's keys, contacts, invites and conversations from the
 * Local_Store in a single transaction (Req 13.8). Other PINs are untouched.
 * If the transaction fails nothing is removed and the error propagates.
 */
export async function cleanupBurnedPin(store: Pick<LocalStore, "purgePin">, pin: string): Promise<void> {
  await store.purgePin(pin);
}
