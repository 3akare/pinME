import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { createDb, isDbNotConfigured } from "../../db/client";
import { PinSchema } from "../../shared/protocol";
import { safeLog } from "../../shared/safeLog";
import {
  createDrizzleDirectoryRepository,
  getPublicProfile,
  registerPin,
  type DirectoryResult,
  type PinRecord,
} from "../directory";
import { guardPrivateKeys } from "../guard";

/** Thrown from validators; carries only a code, never the offending key or value. */
function reject(code: string): never {
  throw new Error(code);
}

/**
 * Runs the private-key guard before anything else touches the body (Req 17.6),
 * then requires a plain object. Field-level validation (strict Zod schema) is
 * applied by `registerPin` in the directory service.
 */
function validateRegisterInput(input: unknown): Record<string, unknown> {
  const guard = guardPrivateKeys(input);
  if (!guard.ok) reject(guard.code);
  const obj = z.record(z.string(), z.unknown()).safeParse(input);
  if (!obj.success) reject("validation_failed");
  return obj.data as Record<string, unknown>;
}

const GetProfileInput = z.strictObject({ pin: PinSchema });

function validateGetProfileInput(input: unknown): { pin: string } {
  const guard = guardPrivateKeys(input);
  if (!guard.ok) reject(guard.code);
  const parsed = GetProfileInput.safeParse(input);
  if (!parsed.success) reject("validation_failed");
  return parsed.data;
}

/** Fresh DB client per request, using DATABASE_URL from the Cloudflare env. */
function repoFromEnv() {
  const db = createDb(env as unknown as { DATABASE_URL?: string });
  return createDrizzleDirectoryRepository(db);
}

async function withRepo(
  run: (repo: ReturnType<typeof repoFromEnv>) => Promise<DirectoryResult<PinRecord>>,
): Promise<DirectoryResult<PinRecord>> {
  try {
    return await run(repoFromEnv());
  } catch (e) {
    if (isDbNotConfigured(e)) {
      safeLog("directory_rejected", { code: "db_not_configured" });
      return { ok: false, code: "verification_unavailable" };
    }
    safeLog("directory_rejected", { code: "verification_unavailable" });
    return { ok: false, code: "verification_unavailable" };
  }
}

export const registerPinFn = createServerFn({ method: "POST" })
  .validator(validateRegisterInput)
  .handler(({ data }) => withRepo((repo) => registerPin(repo, data)));

export const getPublicProfileFn = createServerFn({ method: "GET" })
  .validator(validateGetProfileInput)
  .handler(({ data }) => withRepo((repo) => getPublicProfile(repo, data.pin)));
