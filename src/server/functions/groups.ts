import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { createDb, isDbNotConfigured } from "../../db/client";
import { safeLog } from "../../shared/safeLog";
import { createDrizzleGroupRepository, createGroup, leaveGroup, type GroupDeps, type GroupMailbox } from "../groups";
import { guardPrivateKeys } from "../guard";
import { createVerifyDeps } from "../signedRequest";

function validateSigned(input: unknown): unknown {
  const guard = guardPrivateKeys(input);
  if (!guard.ok) throw new Error(guard.code);
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("validation_failed");
  return input;
}

function depsFromEnv(): GroupDeps {
  const e = env as unknown as Cloudflare.Env & { DATABASE_URL?: string };
  const db = createDb(e);
  return {
    repo: createDrizzleGroupRepository(db),
    verify: createVerifyDeps(db),
    mailboxFor: (pin) => e.PIN_MAILBOX.get(e.PIN_MAILBOX.idFromName(pin)) as unknown as GroupMailbox,
  };
}

async function run<T>(fn: (deps: GroupDeps) => Promise<T>): Promise<T | { ok: false; code: string }> {
  try {
    return await fn(depsFromEnv());
  } catch (err) {
    const code = isDbNotConfigured(err) ? "db_not_configured" : "verification_unavailable";
    safeLog("group_rejected", { code });
    return { ok: false, code };
  }
}

export const createGroupFn = createServerFn({ method: "POST" })
  .validator(validateSigned)
  .handler(({ data }) => run((deps) => createGroup(deps, data)));

export const leaveGroupFn = createServerFn({ method: "POST" })
  .validator(validateSigned)
  .handler(({ data }) => run((deps) => leaveGroup(deps, data)));
