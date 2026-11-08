import { createPin, type CreatePinDeps } from "../pins/createPin";
import type { IdentityRecord, PinRecord } from "../storage";
import { validateOnboarding, type OnboardingErrors, type OnboardingInput } from "./form";

export const FIRST_PIN_LABEL = "Main";

export interface CompleteOnboardingDeps extends Omit<CreatePinDeps, "savePin"> {
  /** Writes the identity and the first PIN in one Local_Store transaction. */
  saveIdentityAndPin: (identity: IdentityRecord, pin: PinRecord) => Promise<void>;
}

export type OnboardingResult =
  | { ok: true; identity: IdentityRecord; pin: PinRecord }
  | { ok: false; kind: "validation"; errors: OnboardingErrors }
  | { ok: false; kind: "failed"; message: string };

/**
 * Validates the form, then registers and stores the first PIN ("Main") together
 * with the Identity. Nothing is written when validation fails or registration fails.
 */
export async function completeOnboarding(
  deps: CompleteOnboardingDeps,
  input: OnboardingInput & { picture?: (Blob & { size: number; type: string }) | null },
): Promise<OnboardingResult> {
  const v = validateOnboarding(input);
  if (!v.ok) return { ok: false, kind: "validation", errors: v.errors };
  const identity: IdentityRecord = {
    displayName: v.displayName,
    ...(input.picture ? { picture: input.picture } : {}),
  };
  try {
    const pin = await createPin(
      {
        ...deps,
        savePin: (record) => deps.saveIdentityAndPin(identity, record),
      },
      { displayName: identity.displayName, label: FIRST_PIN_LABEL },
    );
    return { ok: true, identity, pin };
  } catch (e) {
    return {
      ok: false,
      kind: "failed",
      message: e instanceof Error ? e.message : "PIN creation failed",
    };
  }
}
