import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { createDb, isDbNotConfigured } from "../../db/client";
import { createDirectoryClient } from "../../durable/directoryClient";
import { safeLog } from "../../shared/safeLog";
import { guardPrivateKeys } from "../guard";
import { getPrekeys, publishPrekeys, type PrekeyDeps, type PrekeyMailbox } from "../prekeys";
import { createVerifyDeps } from "../signedRequest";

function validateSigned(input: unknown): unknown {
  const guard = guardPrivateKeys(input);
  if (!guard.ok) throw new Error(guard.code);
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("validation_failed");
  return input;
}

function depsFromEnv(): PrekeyDeps {
  const e = env as unknown as Cloudflare.Env & { DATABASE_URL?: string };
  const db = createDb(e);
  const directory = createDirectoryClient(db);
  return {
    verify: createVerifyDeps(db),
    mailboxFor: (pin) => e.PIN_MAILBOX.get(e.PIN_MAILBOX.idFromName(pin)) as unknown as PrekeyMailbox,
    mayRelay: (a, b) => directory.mayRelay(a, b),
  };
}

async function run<T>(fn: (deps: PrekeyDeps) => Promise<T>): Promise<T | { ok: false; code: string }> {
  try {
    return await fn(depsFromEnv());
  } catch (err) {
    const code = isDbNotConfigured(err) ? "db_not_configured" : "verification_unavailable";
    safeLog("prekey_rejected", { code });
    return { ok: false, code };
  }
}

export const publishPrekeysFn = createServerFn({ method: "POST" })
  .validator(validateSigned)
  .handler(({ data }) => run((deps) => publishPrekeys(deps, data)));

export const getPrekeysFn = createServerFn({ method: "POST" })
  .validator(validateSigned)
  .handler(({ data }) => run((deps) => getPrekeys(deps, data)));
