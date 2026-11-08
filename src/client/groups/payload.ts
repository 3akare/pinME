import { GROUP_NAME_MAX, MAX_GROUP_MEMBERS, MAX_PLAINTEXT_CHARS } from "../../shared/limits";
import { isValidPin } from "../../shared/pin";

/**
 * Group traffic rides inside ordinary encrypted message envelopes, so the protocol keeps its eleven
 * types and the server never learns which group a message belongs to. The plaintext starts with a
 * control character no typed message can contain, then JSON.
 */
const MARK = "\u0001pinme-group:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GroupPayload =
  /** Sent by the creator to each member: the group's name and every member PIN (creator included). */
  | { t: "create"; g: string; name: string; members: string[] }
  | { t: "msg"; g: string; text: string }
  | { t: "leave"; g: string };

export function encodeGroupPayload(p: GroupPayload): string {
  return MARK + JSON.stringify(p);
}

export function isGroupText(text: string): boolean {
  return text.startsWith(MARK);
}

/** The payload, or null for anything malformed (which the receiver then drops). */
export function decodeGroupPayload(text: string): GroupPayload | null {
  if (!isGroupText(text)) return null;
  let v: unknown;
  try {
    v = JSON.parse(text.slice(MARK.length));
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.g !== "string" || !UUID.test(p.g)) return null;
  if (p.t === "msg") {
    return typeof p.text === "string" && p.text.length >= 1 && p.text.length <= MAX_PLAINTEXT_CHARS
      ? { t: "msg", g: p.g, text: p.text }
      : null;
  }
  if (p.t === "leave") return { t: "leave", g: p.g };
  if (p.t === "create") {
    const members = p.members;
    if (typeof p.name !== "string" || p.name.trim().length < 1 || p.name.length > GROUP_NAME_MAX) return null;
    if (!Array.isArray(members) || members.length < 2 || members.length > MAX_GROUP_MEMBERS) return null;
    if (!members.every(isValidPin) || new Set(members).size !== members.length) return null;
    return { t: "create", g: p.g, name: p.name.trim(), members: members as string[] };
  }
  return null;
}
