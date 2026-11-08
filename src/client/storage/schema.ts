import type { DBSchema } from "idb";

export const DB_NAME = "pinme";
export const DB_VERSION = 3;

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

export interface GroupMember {
  pin: string;
  displayName: string;
  boxPk: Uint8Array;
}

/**
 * A group as one own PIN sees it. `members` are the other PINs (never the own one); their keys
 * come from the Directory, not from whoever created the group.
 */
export interface GroupRecord {
  ownPin: string;
  groupId: string;
  name: string;
  members: GroupMember[];
  createdBy: string;
  createdAt: number;
  /** Received messages up to this time have been seen. */
  lastReadAt?: number;
  /**
   * Members whose public keys are still being fetched from the Directory. The group is saved
   * before that lookup, so a reload mid-lookup cannot lose the invitation.
   */
  unresolved?: string[];
}

/** Conversation id a group's messages are filed under (MessageRecord.contactPin). */
export const groupKey = (groupId: string): string => `g:${groupId}`;
export const isGroupKey = (contactPin: string): boolean => contactPin.startsWith("g:");

export interface MessageRecord {
  ownPin: string;
  contactPin: string;
  messageId: string;
  direction: "in" | "out";
  text: string;
  ts: number;
  marker?: Marker;
  /** `group`: a group message (contactPin is groupKey); `system`: a note such as "Ada left". */
  kind: "chat" | "broadcast" | "group" | "system";
  /** Who wrote an incoming group message. */
  sender?: string;
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
  groups: {
    key: [string, string];
    value: GroupRecord;
    indexes: { byOwnPin: string };
  };
  messages: {
    key: [string, string, string];
    value: MessageRecord;
    indexes: { byConversation: [string, string, number]; byOwnPin: string };
  };
}

export type StoreName = "identity" | "pins" | "contacts" | "invites" | "pendingContacts" | "groups" | "messages";

export const STORE_NAMES: readonly StoreName[] = [
  "identity",
  "pins",
  "contacts",
  "invites",
  "pendingContacts",
  "groups",
  "messages",
];
