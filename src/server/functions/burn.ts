import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { createDb, isDbNotConfigured } from "../../db/client";
import { safeLog } from "../../shared/safeLog";
import { burnPin, createDrizzleBurnRepository, type BurnDeps, type BurnMailbox, type BurnResult } from "../burn";
import { guardPrivateKeys } from "../guard";
import { createVerifyDeps } from "../signedRequest";

function validateSigned(input: unknown): unknown {
  const guard = guardPrivateKeys(input);
  if (!guard.ok) throw new Error(guard.code);
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("validation_failed");
  return input;
}

function depsFromEnv(): BurnDeps {
  const e = env as unknown as Cloudflare.Env & { DATABASE_URL?: string };
  const db = createDb(e);
  return {
    repo: createDrizzleBurnRepository(db),
    verify: createVerifyDeps(db),
    mailboxFor: (pin) => e.PIN_MAILBOX.get(e.PIN_MAILBOX.idFromName(pin)) as unknown as BurnMailbox,
  };
}

export const burnPinFn = createServerFn({ method: "POST" })
  .validator(validateSigned)
  .handler(async ({ data }): Promise<BurnResult> => {
    try {
      return await burnPin(depsFromEnv(), data);
    } catch (e) {
      const code = isDbNotConfigured(e) ? "db_not_configured" : "verification_unavailable";
      safeLog("burn_rejected", { code });
      return { ok: false, code };
    }
  });
