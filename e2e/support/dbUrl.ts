import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Finds DATABASE_URL for the e2e run: process env first, then `.dev.vars`
 * (the file the Worker dev server reads). Returns undefined when neither has it.
 */
export function findDatabaseUrl(root: string = process.cwd()): string | undefined {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const file = resolve(root, ".dev.vars");
  if (!existsSync(file)) return undefined;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = (m[1] ?? "").trim().replace(/^(['"])(.*)\1$/, "$2");
    return value || undefined;
  }
  return undefined;
}
