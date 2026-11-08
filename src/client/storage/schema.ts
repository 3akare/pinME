import type { DBSchema } from "idb";

export const DB_NAME = "pinme";
export const DB_VERSION = 2;

export type PinStatus = "active" | "burned";
export type Marker = "clock" | "D" | "R";

export interface IdentityRecord {
  displayName: string;
  /** Display picture, at most 256 KB. */
  picture?: Blob;
}

export interface PinRecord {
  pin: string;
  label: string;
  boxSk: Uint8Array;
  boxPk: Uint8Array;
  signSk: Uint8Array;
  signPk: Uint8Array;
  status: PinStatus;
  /** Own availability; treated as "available" when absent. */
  presence?: "available" | "busy";
  personalMessage: string;
  createdAt: number;
}

export interface ContactRecord {
  ownPin: string;
  contactPin: string;
  displayName: string;
  picture?: Blob;
  boxPk: Uint8Array;
  signPk: Uint8Array;
  status: PinStatus;
  personalMessage: string;
  /** Contact's availability as last reported by the Directory; absent means not known yet. */
  presence?: "available" | "busy";
  unavailable: boolean;
}

export interface InviteRecord {
  inviteId: string;
  ownPin: string;
  fromPin: string;
  /** Inviter's public display name, when the Directory lookup succeeded. */
  fromDisplayName?: string;
  createdAt: number;
}

/**
 * An `accepted` notice whose Contact keys are not stored yet. Written before the profile
 * lookup so a reload in between cannot lose the acceptance (the server drops delivered notices).
 */
export interface PendingContactRecord {
  ownPin: string;
  contactPin: string;
  receivedAt: number;
}

export interface MessageRecord {
  ownPin: string;
  contactPin: string;
  messageId: string;
  direction: "in" | "out";
  text: string;
  ts: number;
  marker?: Marker;
  kind: "chat" | "broadcast";
}

export interface PinmeDB extends DBSchema {
  identity: { key: "me"; value: IdentityRecord };
  pins: { key: string; value: PinRecord };
  contacts: {
    key: [string, string];
    value: ContactRecord;
    indexes: { byOwnPin: string };
  };
  invites: {
    key: string;
    value: InviteRecord;
    indexes: { byOwnPin: string };
  };
  pendingContacts: {
    key: [string, string];
    value: PendingContactRecord;
  };
  messages: {
    key: [string, string, string];
    value: MessageRecord;
    indexes: { byConversation: [string, string, number]; byOwnPin: string };
  };
}

export type StoreName = "identity" | "pins" | "contacts" | "invites" | "pendingContacts" | "messages";

export const STORE_NAMES: readonly StoreName[] = [
  "identity",
  "pins",
  "contacts",
  "invites",
  "pendingContacts",
  "messages",
];
