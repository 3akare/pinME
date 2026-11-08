import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { createDb, isDbNotConfigured } from "../../db/client";
import { safeLog } from "../../shared/safeLog";
import { guardPrivateKeys } from "../guard";
import {
  createDrizzleInviteRepository,
  respondInvite,
  sendInvite,
  type InviteDeps,
  type InviteMailbox,
  type InviteResult,
} from "../invites";
import { createVerifyDeps } from "../signedRequest";

/** Thrown from validators; carries only a code, never the offending key or value. */
function validateSigned(input: unknown): unknown {
  const guard = guardPrivateKeys(input);
  if (!guard.ok) throw new Error(guard.code);
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("validation_failed");
  return input;
}

function depsFromEnv(): InviteDeps {
  const e = env as unknown as Cloudflare.Env & { DATABASE_URL?: string };
  const db = createDb(e);
  return {
    repo: createDrizzleInviteRepository(db),
    verify: createVerifyDeps(db),
    mailboxFor: (pin) => e.PIN_MAILBOX.get(e.PIN_MAILBOX.idFromName(pin)) as unknown as InviteMailbox,
  };
}

async function run<T>(fn: (deps: InviteDeps) => Promise<InviteResult<T>>): Promise<InviteResult<T>> {
  try {
    return await fn(depsFromEnv());
  } catch (e) {
    const code = isDbNotConfigured(e) ? "db_not_configured" : "verification_unavailable";
    safeLog("invite_rejected", { code });
    return { ok: false, code };
  }
}

export const sendInviteFn = createServerFn({ method: "POST" })
  .validator(validateSigned)
  .handler(({ data }) => run((deps) => sendInvite(deps, data)));

export const respondInviteFn = createServerFn({ method: "POST" })
  .validator(validateSigned)
  .handler(({ data }) => run((deps) => respondInvite(deps, data)));
