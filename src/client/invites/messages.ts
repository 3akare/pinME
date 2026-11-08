export const PIN_FORMAT_MESSAGE = "Enter a valid PIN (8 characters, 0-9 and A-F).";

/** User-facing text for a failed sendInvite. */
export function addErrorMessage(code: string, retryAfterSec?: number): string {
  switch (code) {
    case "not_found":
      return "No PIN found with that value.";
    case "pin_burned":
      return "That PIN has been burned.";
    case "self_invite":
      return "You cannot invite your own PIN.";
    case "duplicate":
      return "You already have a pending invite or contact with that PIN.";
    case "rate_limited":
      return retryAfterSec
        ? `Too many invites. Try again in ${retryAfterSec} seconds.`
        : "Too many invites. Try again later.";
    case "validation_failed":
      return PIN_FORMAT_MESSAGE;
    default:
      return "Could not send the invite. Please try again.";
  }
}

/** User-facing text for a failed accept or decline. */
export function inviteErrorMessage(code: string): string {
  switch (code) {
    case "not_found":
      return "This invite is no longer available.";
    case "pin_burned":
      return "That PIN has been burned.";
    case "rate_limited":
      return "Too many requests. Try again shortly.";
    default:
      return "Could not complete that. Please try again.";
  }
}
