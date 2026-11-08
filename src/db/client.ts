import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export class DbNotConfiguredError extends Error {
  readonly code = "db_not_configured";
  constructor() {
    super("db_not_configured");
    this.name = "DbNotConfiguredError";
  }
}

export function isDbNotConfigured(e: unknown): e is DbNotConfiguredError {
  return (
    e instanceof DbNotConfiguredError ||
    (typeof e === "object" &&
      e !== null &&
      (("code" in e && (e as { code?: unknown }).code === "db_not_configured") ||
        ("name" in e && (e as { name?: unknown }).name === "DbNotConfiguredError")))
  );
}

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Creates a fresh Neon client for a single request. Never cache the result
 * across requests (Workers forbid sharing I/O objects between requests).
 * Throws `db_not_configured` before any connection attempt when the URL is
 * missing or empty.
 */
export function createDb(env: { DATABASE_URL?: string | null } | undefined): Db {
  const url = env?.DATABASE_URL;
  if (typeof url !== "string" || url.trim() === "") {
    throw new DbNotConfiguredError();
  }
  const pool = new Pool({ connectionString: url });
  return drizzle(pool, { schema });
}

export { schema };
