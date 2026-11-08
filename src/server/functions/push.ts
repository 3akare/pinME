import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { createDb, isDbNotConfigured } from "../../db/client";
import { safeLog } from "../../shared/safeLog";
import { guardPrivateKeys } from "../guard";
import { registerPush, type PushMailbox, type PushResult } from "../push";
import { createVerifyDeps } from "../signedRequest";

type PushEnv = Cloudflare.Env & { DATABASE_URL?: string; VAPID_PUBLIC_KEY?: string };

function validateSigned(input: unknown): unknown {
  const guard = guardPrivateKeys(input);
  if (!guard.ok) throw new Error(guard.code);
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("validation_failed");
  return input;
}

/** The public VAPID key browsers subscribe with, or null when pushes are not configured. */
export const getPushConfigFn = createServerFn({ method: "GET" }).handler(async () => {
  const key = (env as unknown as PushEnv).VAPID_PUBLIC_KEY?.trim();
  return { publicKey: key ? key : null };
});

export const registerPushFn = createServerFn({ method: "POST" })
  .validator(validateSigned)
  .handler(async ({ data }): Promise<PushResult> => {
    const e = env as unknown as PushEnv;
    try {
      return await registerPush(
        {
          verify: createVerifyDeps(createDb(e)),
          mailboxFor: (pin) => e.PIN_MAILBOX.get(e.PIN_MAILBOX.idFromName(pin)) as unknown as PushMailbox,
        },
        data,
      );
    } catch (err) {
      const code = isDbNotConfigured(err) ? "db_not_configured" : "verification_unavailable";
      safeLog("push_rejected", { code });
      return { ok: false, code };
    }
  });
