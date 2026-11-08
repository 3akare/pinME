import { generatePinKeys, randomBytes, ready } from "../crypto";
import { completeOnboarding, type OnboardingResult } from "../onboarding/complete";
import { useIdentityStore } from "../state/identity";
import { usePinsStore } from "../state/pins";
import { registerPinFn } from "../../server/functions/pins";
import { bootstrapApp, getLocalStore } from "./bootstrap";

/**
 * Creates the identity and its first PIN, then connects at once so a code or link
 * can be used (or answered) right away. Shared by onboarding and the connect link.
 */
export async function createIdentity(input: { displayName: string; picture?: File | null }): Promise<OnboardingResult> {
  const [store] = await Promise.all([getLocalStore(), ready()]);
  const result = await completeOnboarding(
    {
      randomBytes,
      generatePinKeys,
      registerPin: (body) => registerPinFn({ data: body }),
      saveIdentityAndPin: (id, pin) =>
        store.transaction(["identity", "pins"], async (repos) => {
          await repos.identityRepo.put(id);
          await repos.pinRepo.put(pin);
        }),
    },
    input,
  );
  if (result.ok) {
    useIdentityStore.getState().setIdentity(result.identity);
    usePinsStore.getState().addPin(result.pin);
    await bootstrapApp(true);
  }
  return result;
}
