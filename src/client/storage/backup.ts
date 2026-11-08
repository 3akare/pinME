import { base64ToBytes, bytesToBase64 } from "../../shared/base64";
import type { LocalStore } from "./index";
import type {
  ContactRecord,
  IdentityRecord,
  InviteRecord,
  MessageRecord,
  PendingContactRecord,
  PinRecord,
} from "./schema";

/** Everything that lives only on this device. */
export interface Snapshot {
  version: 1;
  identity: IdentityRecord;
  pins: PinRecord[];
  contacts: ContactRecord[];
  invites: InviteRecord[];
  pendingContacts: PendingContactRecord[];
  messages: MessageRecord[];
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Bytes and pictures become tagged JSON so the snapshot survives a text file. */
async function encode(v: unknown): Promise<Json> {
  if (v instanceof Uint8Array) return { $bytes: bytesToBase64(v) };
  if (typeof Blob !== "undefined" && v instanceof Blob) {
    return { $blob: bytesToBase64(new Uint8Array(await v.arrayBuffer())), type: v.type };
  }
  if (Array.isArray(v)) return Promise.all(v.map(encode));
  if (v && typeof v === "object") {
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = await encode(x);
    return out;
  }
  return v as Json;
}

function decode(v: Json): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    if (typeof v.$bytes === "string" && Object.keys(v).length === 1) return base64ToBytes(v.$bytes);
    if (typeof v.$blob === "string") return new Blob([base64ToBytes(v.$blob) as BlobPart], { type: String(v.type ?? "") });
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

export async function exportSnapshot(store: LocalStore): Promise<Uint8Array> {
  const db = store.db;
  const identity = await store.identityRepo.get();
  if (!identity) throw new Error("no_identity");
  const snapshot: Snapshot = {
    version: 1,
    identity,
    pins: await db.getAll("pins"),
    contacts: await db.getAll("contacts"),
    invites: await db.getAll("invites"),
    pendingContacts: await db.getAll("pendingContacts"),
    messages: await db.getAll("messages"),
  };
  return new TextEncoder().encode(JSON.stringify(await encode(snapshot)));
}

const isArr = (x: unknown): x is unknown[] => Array.isArray(x);

/** Parses decrypted bytes; null unless it has the shape a snapshot must have. */
export function parseSnapshot(bytes: Uint8Array): Snapshot | null {
  let raw: unknown;
  try {
    raw = decode(JSON.parse(new TextDecoder().decode(bytes)) as Json);
  } catch {
    return null;
  }
  const s = raw as Partial<Snapshot> | null;
  if (!s || s.version !== 1 || typeof s.identity?.displayName !== "string") return null;
  if (![s.pins, s.contacts, s.invites, s.pendingContacts, s.messages].every(isArr)) return null;
  const pinOk = (p: PinRecord) =>
    typeof p.pin === "string" && p.boxSk instanceof Uint8Array && p.signSk instanceof Uint8Array && typeof p.label === "string";
  if (!(s.pins as PinRecord[]).every(pinOk)) return null;
  return s as Snapshot;
}

/**
 * Writes a snapshot onto an empty device in one transaction: all of it lands or none of it does.
 * Refuses when this device already has an identity, so a restore never mixes two people's data.
 */
export async function importSnapshot(store: LocalStore, s: Snapshot): Promise<"restored" | "has_identity"> {
  if (await store.identityRepo.get()) return "has_identity";
  await store.transaction(["identity", "pins", "contacts", "invites", "pendingContacts", "messages"], async (repos, tx) => {
    await repos.identityRepo.put(s.identity);
    for (const p of s.pins) await repos.pinRepo.put(p);
    for (const c of s.contacts) await repos.contactRepo.put(c);
    for (const i of s.invites) await repos.inviteRepo.put(i);
    for (const p of s.pendingContacts) await repos.pendingContactRepo.put(p);
    const messages = tx.objectStore("messages");
    for (const m of s.messages) await messages.put(m);
  });
  return "restored";
}
