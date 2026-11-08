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
  /**
   * Secret carried in this PIN's QR code and invite link. Invites that echo it are accepted
   * automatically; replacing it revokes every code shared so far.
   */
  inviteToken?: string;
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
  /** Received messages up to this time have been seen; later ones count as unread. */
  lastReadAt?: number;
}

export interface InviteRecord {
  inviteId: string;
  ownPin: string;
  fromPin: string;
  /** Inviter's public display name, when the Directory lookup succeeded. */
  fromDisplayName?: string;
  /** Token the inviter echoed from one of our links. */
  token?: string;
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
  /** Outgoing message written while offline; sent when the session authenticates. */
  pending?: boolean;
  /** Outgoing message the server refused for good (e.g. the contact is gone). */
  failed?: boolean;
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
