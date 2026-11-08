import { sql } from "drizzle-orm";
import {
  char,
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const pins = pgTable("pins", {
  pin: char("pin", { length: 8 }).primaryKey(),
  boxPublicKey: text("box_public_key").notNull(), // X25519, base64
  signPublicKey: text("sign_public_key").notNull(), // Ed25519, base64
  displayName: varchar("display_name", { length: 32 }).notNull(),
  status: text("status", { enum: ["available", "busy"] })
    .notNull()
    .default("available"),
  personalMessage: varchar("personal_message", { length: 80 }).notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const burnedPins = pgTable("burned_pins", {
  pin: char("pin", { length: 8 }).primaryKey(),
  signPublicKey: text("sign_public_key").notNull(), // retained only to authenticate idempotent re-burns
  burnedAt: timestamp("burned_at").defaultNow().notNull(),
});

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromPin: char("from_pin", { length: 8 }).notNull(),
    toPin: char("to_pin", { length: 8 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invites_pair").on(
      sql`least(${t.fromPin}, ${t.toPin})`,
      sql`greatest(${t.fromPin}, ${t.toPin})`,
    ),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    pinLow: char("pin_low", { length: 8 }).notNull(),
    pinHigh: char("pin_high", { length: 8 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pinLow, t.pinHigh] }),
    check("ordered", sql`${t.pinLow} < ${t.pinHigh}`),
  ],
);

// Operational table for replay protection (Req 19.5/19.9)
export const usedNonces = pgTable(
  "used_nonces",
  {
    pin: char("pin", { length: 8 }).notNull(),
    nonce: text("nonce").notNull(),
    usedAt: timestamp("used_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.pin, t.nonce] })],
);
