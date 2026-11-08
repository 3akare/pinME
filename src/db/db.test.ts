import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { createDb, DbNotConfiguredError } from "./client";
import * as schema from "./schema";

describe("createDb configuration (Req 18.7)", () => {
  const cases: Array<[string, unknown]> = [
    ["undefined env", undefined],
    ["missing DATABASE_URL", {}],
    ["null DATABASE_URL", { DATABASE_URL: null }],
    ["empty DATABASE_URL", { DATABASE_URL: "" }],
    ["whitespace DATABASE_URL", { DATABASE_URL: "   " }],
  ];

  it.each(cases)("fails with db_not_configured for %s", (_n, env) => {
    let err: unknown;
    try {
      createDb(env as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DbNotConfiguredError);
    expect((err as DbNotConfiguredError).code).toBe("db_not_configured");
    expect((err as Error).message).toBe("db_not_configured");
  });
});

describe("schema tables (Req 18.11)", () => {
  it("has exactly the expected table names", () => {
    const names = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((v) => getTableConfig(v as PgTable).name)
      .sort();
    // group_members and groups: the group-chats stretch feature (relay between group-mates).
    expect(names).toEqual(["burned_pins", "contacts", "group_members", "groups", "invites", "pins", "used_nonces"]);
  });
});

describe("schema has no cross-PIN owner linkage (Req 2.9)", () => {
  const tables = [schema.pins, schema.invites, schema.contacts, schema.burnedPins, schema.usedNonces];

  it("declares no foreign keys", () => {
    for (const t of tables) {
      expect(getTableConfig(t).foreignKeys).toHaveLength(0);
    }
  });

  it("has no owner/account/user/device column in any table", () => {
    const banned = /owner|account|user|device|session|email/i;
    for (const t of tables) {
      for (const c of getTableConfig(t).columns) {
        expect(c.name, `${getTableConfig(t).name}.${c.name}`).not.toMatch(banned);
      }
    }
  });

  it("pins table carries a single PIN column and no other PIN reference", () => {
    const cols = getTableConfig(schema.pins).columns.map((c) => c.name);
    expect(cols.filter((n) => /pin/i.test(n) && !/message/i.test(n))).toEqual(["pin"]);
  });
});
