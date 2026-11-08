import {
  openDB,
  type IDBPDatabase,
  type IDBPObjectStore,
  type IDBPTransaction,
} from "idb";
import {
  DB_NAME,
  DB_VERSION,
  type ContactRecord,
  type IdentityRecord,
  type InviteRecord,
  type MessageRecord,
  type Marker,
  type PendingContactRecord,
  type GroupRecord,
  type PrekeyRecord,
  type SessionRecord,
  type PinRecord,
  type PinmeDB,
  type StoreName,
} from "./schema";

export * from "./schema";

export type LocalDB = IDBPDatabase<PinmeDB>;
export type LocalTx = IDBPTransaction<PinmeDB, StoreName[], "readwrite">;

/** Resolves an object store either via a one-shot transaction or an open shared transaction. */
interface Ctx {
  store<N extends StoreName>(
    name: N,
  ): IDBPObjectStore<PinmeDB, StoreName[], N, "readwrite">;
}

function dbCtx(db: LocalDB): Ctx {
  return {
    store: (name) =>
      db.transaction(name, "readwrite").store as unknown as IDBPObjectStore<
        PinmeDB,
        StoreName[],
        typeof name,
        "readwrite"
      >,
  };
}

function txCtx(tx: LocalTx): Ctx {
  return { store: (name) => tx.objectStore(name) };
}

/** Key range matching every compound key that starts with `prefix`. */
function prefixRange(...prefix: string[]): IDBKeyRange {
  return IDBKeyRange.bound(prefix, [...prefix, []]);
}

export interface Repositories {
  identityRepo: {
    get(): Promise<IdentityRecord | undefined>;
    put(identity: IdentityRecord): Promise<void>;
    clear(): Promise<void>;
  };
  pinRepo: {
    get(pin: string): Promise<PinRecord | undefined>;
    getAll(): Promise<PinRecord[]>;
    put(record: PinRecord): Promise<void>;
    delete(pin: string): Promise<void>;
  };
  contactRepo: {
    get(ownPin: string, contactPin: string): Promise<ContactRecord | undefined>;
    listForPin(ownPin: string): Promise<ContactRecord[]>;
    put(record: ContactRecord): Promise<void>;
    delete(ownPin: string, contactPin: string): Promise<void>;
  };
  inviteRepo: {
    get(inviteId: string): Promise<InviteRecord | undefined>;
    listForPin(ownPin: string): Promise<InviteRecord[]>;
    put(record: InviteRecord): Promise<void>;
    delete(inviteId: string): Promise<void>;
  };
  pendingContactRepo: {
    listAll(): Promise<PendingContactRecord[]>;
    put(record: PendingContactRecord): Promise<void>;
    delete(ownPin: string, contactPin: string): Promise<void>;
  };
  groupRepo: {
    get(ownPin: string, groupId: string): Promise<GroupRecord | undefined>;
    listForPin(ownPin: string): Promise<GroupRecord[]>;
    put(record: GroupRecord): Promise<void>;
    delete(ownPin: string, groupId: string): Promise<void>;
  };
  sessionRepo: {
    get(ownPin: string, peerPin: string): Promise<SessionRecord | undefined>;
    put(record: SessionRecord): Promise<void>;
  };
  prekeyRepo: {
    get(ownPin: string, id: number): Promise<PrekeyRecord | undefined>;
    listForPin(ownPin: string): Promise<PrekeyRecord[]>;
    put(record: PrekeyRecord): Promise<void>;
    delete(ownPin: string, id: number): Promise<void>;
  };
  messageRepo: {
    get(
      ownPin: string,
      contactPin: string,
      messageId: string,
    ): Promise<MessageRecord | undefined>;
    /** Messages of one conversation ordered by timestamp ascending. */
    listConversation(ownPin: string, contactPin: string): Promise<MessageRecord[]>;
    put(record: MessageRecord): Promise<void>;
    /** Outgoing messages of one own PIN still waiting for a connection, oldest first. */
    listPending(ownPin: string): Promise<MessageRecord[]>;
    setMarker(
      ownPin: string,
      contactPin: string,
      messageId: string,
      marker: Marker,
    ): Promise<void>;
    deleteConversation(ownPin: string, contactPin: string): Promise<void>;
  };
}

function buildRepos(ctx: Ctx): Repositories {
  return {
    identityRepo: {
      get: () => ctx.store("identity").get("me"),
      put: async (identity) => {
        await ctx.store("identity").put(identity, "me");
      },
      clear: () => ctx.store("identity").clear(),
    },
    pinRepo: {
      get: (pin) => ctx.store("pins").get(pin),
      getAll: () => ctx.store("pins").getAll(),
      put: async (record) => {
        await ctx.store("pins").put(record);
      },
      delete: (pin) => ctx.store("pins").delete(pin),
    },
    contactRepo: {
      get: (ownPin, contactPin) => ctx.store("contacts").get([ownPin, contactPin]),
      listForPin: (ownPin) => ctx.store("contacts").index("byOwnPin").getAll(ownPin),
      put: async (record) => {
        await ctx.store("contacts").put(record);
      },
      delete: (ownPin, contactPin) => ctx.store("contacts").delete([ownPin, contactPin]),
    },
    inviteRepo: {
      get: (inviteId) => ctx.store("invites").get(inviteId),
      listForPin: (ownPin) => ctx.store("invites").index("byOwnPin").getAll(ownPin),
      put: async (record) => {
        await ctx.store("invites").put(record);
      },
      delete: (inviteId) => ctx.store("invites").delete(inviteId),
    },
    pendingContactRepo: {
      listAll: () => ctx.store("pendingContacts").getAll(),
      put: async (record) => {
        await ctx.store("pendingContacts").put(record);
      },
      delete: (ownPin, contactPin) => ctx.store("pendingContacts").delete([ownPin, contactPin]),
    },
    groupRepo: {
      get: (ownPin, groupId) => ctx.store("groups").get([ownPin, groupId]),
      listForPin: (ownPin) => ctx.store("groups").index("byOwnPin").getAll(ownPin),
      put: async (record) => {
        await ctx.store("groups").put(record);
      },
      delete: (ownPin, groupId) => ctx.store("groups").delete([ownPin, groupId]),
    },
    sessionRepo: {
      get: (ownPin, peerPin) => ctx.store("sessions").get([ownPin, peerPin]),
      put: async (record) => {
        await ctx.store("sessions").put(record);
      },
    },
    prekeyRepo: {
      get: (ownPin, id) => ctx.store("prekeys").get([ownPin, id]),
      listForPin: (ownPin) => ctx.store("prekeys").index("byOwnPin").getAll(ownPin),
      put: async (record) => {
        await ctx.store("prekeys").put(record);
      },
      delete: (ownPin, id) => ctx.store("prekeys").delete([ownPin, id]),
    },
    messageRepo: {
      get: (ownPin, contactPin, messageId) =>
        ctx.store("messages").get([ownPin, contactPin, messageId]),
      listConversation: (ownPin, contactPin) =>
        ctx
          .store("messages")
          .index("byConversation")
          .getAll(
            IDBKeyRange.bound(
              [ownPin, contactPin, -Infinity],
              [ownPin, contactPin, Infinity],
            ),
          ),
      put: async (record) => {
        await ctx.store("messages").put(record);
      },
      listPending: async (ownPin) =>
        (await ctx.store("messages").index("byOwnPin").getAll(ownPin))
          .filter((m) => m.pending && m.direction === "out")
          .sort((a, b) => a.ts - b.ts),
      setMarker: async (ownPin, contactPin, messageId, marker) => {
        const store = ctx.store("messages");
        const existing = await store.get([ownPin, contactPin, messageId]);
        if (existing) await store.put({ ...existing, marker });
      },
      deleteConversation: (ownPin, contactPin) =>
        ctx.store("messages").delete(prefixRange(ownPin, contactPin)),
    },
  };
}

export interface LocalStore extends Repositories {
  readonly db: LocalDB;
  /**
   * Runs `fn` in a single readwrite transaction over `stores`. The transaction
   * commits when `fn` resolves and aborts (rolling back every write) if it throws.
   * Do not await non-IndexedDB work inside `fn`.
   */
  transaction<T>(
    stores: readonly StoreName[],
    fn: (repos: Repositories, tx: LocalTx) => Promise<T>,
  ): Promise<T>;
  /**
   * Atomically removes everything belonging to `pin`: keys, contacts, pending contacts,
   * invites, messages. Other PINs' data is untouched.
   */
  purgePin(pin: string): Promise<void>;
  close(): void;
}

export async function openLocalStore(name: string = DB_NAME): Promise<LocalStore> {
  const db = await openDB<PinmeDB>(name, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 4) {
        database.createObjectStore("sessions", { keyPath: ["ownPin", "peerPin"] });
        database.createObjectStore("prekeys", { keyPath: ["ownPin", "id"] }).createIndex("byOwnPin", "ownPin");
      }
      if (oldVersion < 3) {
        database.createObjectStore("groups", { keyPath: ["ownPin", "groupId"] }).createIndex("byOwnPin", "ownPin");
      }
      if (oldVersion < 2) {
        database.createObjectStore("pendingContacts", { keyPath: ["ownPin", "contactPin"] });
      }
      if (oldVersion >= 1) return;
      database.createObjectStore("identity");
      database.createObjectStore("pins", { keyPath: "pin" });
      const contacts = database.createObjectStore("contacts", {
        keyPath: ["ownPin", "contactPin"],
      });
      contacts.createIndex("byOwnPin", "ownPin");
      const invites = database.createObjectStore("invites", { keyPath: "inviteId" });
      invites.createIndex("byOwnPin", "ownPin");
      const messages = database.createObjectStore("messages", {
        keyPath: ["ownPin", "contactPin", "messageId"],
      });
      messages.createIndex("byConversation", ["ownPin", "contactPin", "ts"]);
      messages.createIndex("byOwnPin", "ownPin");
    },
  });

  const transaction: LocalStore["transaction"] = async (stores, fn) => {
    const tx = db.transaction([...stores], "readwrite") as LocalTx;
    try {
      const result = await fn(buildRepos(txCtx(tx)), tx);
      await tx.done;
      return result;
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // already finished or aborted
      }
      await tx.done.catch(() => undefined);
      throw err;
    }
  };

  const purgePin: LocalStore["purgePin"] = (pin) =>
    transaction(["pins", "contacts", "pendingContacts", "groups", "sessions", "prekeys", "invites", "messages"], async (_repos, tx) => {
      await tx.objectStore("pins").delete(pin);
      await tx.objectStore("contacts").delete(prefixRange(pin));
      await tx.objectStore("pendingContacts").delete(prefixRange(pin));
      await tx.objectStore("groups").delete(prefixRange(pin));
      await tx.objectStore("sessions").delete(prefixRange(pin));
      await tx.objectStore("prekeys").delete(IDBKeyRange.bound([pin, -Infinity], [pin, Infinity]));
      await tx.objectStore("messages").delete(prefixRange(pin));
      const invites = tx.objectStore("invites").index("byOwnPin");
      for await (const cursor of invites.iterate(pin)) await cursor.delete();
    });

  return {
    ...buildRepos(dbCtx(db)),
    db,
    transaction,
    purgePin,
    close: () => db.close(),
  };
}
