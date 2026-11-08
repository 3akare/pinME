import { generatePinKeys, ready, randomBytes, signRequest } from "../crypto";
import { createProfileUpdater, type ProfileUpdaterDeps } from "../profile/update";
import type { BurnFlowDeps } from "../pins/burn";
import type { ManagePinsDeps } from "../pins/manage";
import { usePinsStore } from "../state/pins";
import { useContactsStore } from "../state/contacts";
import { useChatStore } from "../state/chat";
import { cleanupBurnedPin } from "../storage/burnCleanup";
import { burnPinFn } from "../../server/functions/burn";
import { updateProfileFn } from "../../server/functions/profile";
import { registerPinFn } from "../../server/functions/pins";
import { getConnectionManager, getLocalStore } from "./bootstrap";

/** Builds PIN-manager dependencies wired to the real server functions, Local_Store and connections. */
export async function buildManagePinsDeps(): Promise<ManagePinsDeps> {
  const [store, connections] = await Promise.all([getLocalStore(), getConnectionManager(), ready()]);
  return {
    getPins: () => usePinsStore.getState().pins,
    createPinDeps: {
      randomBytes,
      generatePinKeys,
      registerPin: (body) => registerPinFn({ data: body }),
      savePin: (record) => store.pinRepo.put(record),
    },
    savePin: (record) => store.pinRepo.put(record),
    connections,
    onPinChanged: (record) => usePinsStore.getState().addPin(record),
  };
}

/** Builds the profile updater; saved values are mirrored into the pins store. */
export async function buildProfileUpdater() {
  const [store] = await Promise.all([getLocalStore(), ready()]);
  return createProfileUpdater({
    repos: store,
    signRequest: (fields, sk) => signRequest(fields, sk),
    randomBytes,
    updateProfileFn: (req) => updateProfileFn({ data: req }) as ReturnType<ProfileUpdaterDeps["updateProfileFn"]>,
    onSaved: (pin) => usePinsStore.getState().addPin(pin),
  });
}
/** Builds the burn flow wired to the real server function, Local_Store, connections and stores. */
export async function buildBurnFlowDeps(
  playAnimation: () => Promise<void>,
): Promise<BurnFlowDeps> {
  const [store, connections] = await Promise.all([getLocalStore(), getConnectionManager(), ready()]);
  return {
    signRequest: (fields, sk) => signRequest(fields, sk),
    randomBytes,
    burnPinFn: (req) => burnPinFn({ data: req }) as Promise<{ ok: boolean }>,
    playAnimation,
    cleanup: (pin) => cleanupBurnedPin(store, pin),
    closeSession: (pin) => connections.remove(pin),
    updateStores: (pin) => {
      usePinsStore.getState().removePin(pin);
      const contacts = useContactsStore.getState();
      contacts.setAll(
        contacts.contacts.filter((c) => c.ownPin !== pin),
        contacts.pendingInvites.filter((i) => i.ownPin !== pin),
      );
      useChatStore.setState((s) => ({
        messages: Object.fromEntries(Object.entries(s.messages).filter(([k]) => !k.startsWith(`${pin}:`))),
      }));
    },
  };
}
