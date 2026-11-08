import type { ContactRecord, Repositories } from "../../storage";
import type { Dispatcher } from "../dispatch";
export interface BurnedHandlerDeps {
  ownPin: string;
  repos: Pick<Repositories, "contactRepo">;
  store: { upsertContact(contact: ContactRecord): void };
}
/**
 * Marks the Contact whose PIN was burned as unavailable (Req 13.10), in the
 * Local_Store and the contacts store. Uses listen() so other handlers coexist.
 */
export function registerBurnedHandlers(dispatcher: Dispatcher, deps: BurnedHandlerDeps): () => void {
  return dispatcher.listen("contactBurned", (msg) => {
    void (async () => {
      const existing = await deps.repos.contactRepo.get(deps.ownPin, msg.pin);
      if (!existing) return;
      const next: ContactRecord = { ...existing, unavailable: true };
      await deps.repos.contactRepo.put(next);
      deps.store.upsertContact(next);
    })().catch(() => {});
  });
}
