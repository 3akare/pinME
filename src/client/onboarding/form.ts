import { DISPLAY_NAME_MAX } from "../../shared/limits";
import { isValidDisplayName } from "../../shared/validation";

/** Display picture limit: 256 KB (Req 1.6). */
export const PICTURE_MAX_BYTES = 256 * 1024;

export const DISPLAY_NAME_MESSAGE = `Display name must be 1 to ${DISPLAY_NAME_MAX} characters.`;
export const PICTURE_MESSAGE = "Picture must be an image file of at most 256 KB.";

/** Minimal file shape so the module is testable without DOM File. */
export interface PictureLike {
  size: number;
  type: string;
}

export interface OnboardingInput {
  displayName: string;
  picture?: PictureLike | null;
}

export interface OnboardingErrors {
  displayName?: string;
  picture?: string;
}

export type OnboardingValidation =
  | { ok: true; displayName: string; picture?: PictureLike }
  | { ok: false; errors: OnboardingErrors };

export function validateDisplayName(value: string): string | undefined {
  return isValidDisplayName(value) ? undefined : DISPLAY_NAME_MESSAGE;
}

/** Undefined (valid) when absent, or an image of at most 256 KB. */
export function validatePicture(picture: PictureLike | null | undefined): string | undefined {
  if (!picture) return undefined;
  if (!picture.type.startsWith("image/") || picture.size > PICTURE_MAX_BYTES) {
    return PICTURE_MESSAGE;
  }
  return undefined;
}

/** Validates the whole form; the display name is returned trimmed. */
export function validateOnboarding(input: OnboardingInput): OnboardingValidation {
  const errors: OnboardingErrors = {};
  const nameError = validateDisplayName(input.displayName);
  if (nameError) errors.displayName = nameError;
  const pictureError = validatePicture(input.picture);
  if (pictureError) errors.picture = pictureError;
  if (errors.displayName || errors.picture) return { ok: false, errors };
  return {
    ok: true,
    displayName: input.displayName.trim(),
    ...(input.picture ? { picture: input.picture } : {}),
  };
}
