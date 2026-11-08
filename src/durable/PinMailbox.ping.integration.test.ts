/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { PinMailbox, type PinMailboxDeps } from "./PinMailbox";

// Validates: Requirements 9.4, 9.5, 9.7, 9.8, 16.5
const SENDER = "AAAAAAAA";
const RECIPIENT = "BBBBBBBB";

class Store {
  map = new Map<string, unknown>();
  async get<T>(k: string) {
    return this.map.get(k) as T | undefined;
  }
  async put<T>(k: string, v: T) {
    this.map.set(k, v);
  }
  async delete(k: string) {
    return this.map.delete(k);
  }
}
class Sock {
  sent: Record<string, unknown>[] = [];
  constructor(private att: unknown) {}
  deserializeAttachment() {
    return this.att;
  }
  send(d: string) {
    this.sent.push(JSON.parse(d) as Record<string, unknown>);
  }
}

let realState: DurableObjectState | undefined;
beforeAll(async () => {
  const stub = env.PIN_MAILBOX.get(env.PIN_MAILBOX.idFromName("ping-harness"));
  await runInDurableObject(stub, (_i, state) => {
    realState = state;
  });
});

function node(pin: string, deps: Partial<PinMailboxDeps>, online: boolean, accepted: boolean | "down" = true) {
  const storage = new Store();
  storage.map.set("meta:pin", pin);
  const socket = new Sock({ authenticated: true, pin });
  const ctx = { storage, getWebSockets: () => (online ? [socket] : []) } as unknown as DurableObjectState;
  const directory = () =>
    ({
      isContactPair: async () => {
        if (accepted === "down") throw new Error("down");
        return accepted;
      },
      mayRelay: async () => {
        if (accepted === "down") throw new Error("down");
        return accepted;
      },
      lookupPin: async () => ({ state: "active" }),
    }) as never;
  const mailbox = new PinMailbox(realState!, env as never, { now: () => clock.t, directory, ...deps });
  Object.defineProperty(mailbox, "ctx", { value: ctx, configurable: true });
  return { storage, socket, mailbox };
}
const clock = { t: 1_000_000 };

type Priv = { onPing(ws: unknown, a: unknown, to: string): Promise<void> };

function setup(online: boolean, recipientAccepts = true) {
  clock.t = 1_000_000;
  const recipient = node(RECIPIENT, {}, online, recipientAccepts);
  const sender = node(SENDER, { mailbox: () => recipient.mailbox }, true);
  const ping = () =>
    (sender.mailbox as unknown as Priv).onPing(sender.socket, { authenticated: true, pin: SENDER }, RECIPIENT);
  return { recipient, sender, ping };
}

describe("PinMailbox ping", () => {
  it("delivers to an online contact, stores nothing, and rate limits the second ping", async () => {
    const { recipient, sender, ping } = setup(true);
    await ping();
    expect(recipient.socket.sent).toEqual([{ type: "ping", from: SENDER }]);
    expect(sender.socket.sent).toHaveLength(0);
    await ping();
    expect(recipient.socket.sent).toHaveLength(1);
    expect(sender.socket.sent).toEqual([{ type: "error", code: "rate_limited", retryAfterSec: 10 }]);
    clock.t += 10_000;
    await ping();
    expect(recipient.socket.sent).toHaveLength(2);
    expect([...recipient.storage.map.keys()]).toEqual(["meta:pin"]);
  });

  it("returns not_delivered when the recipient has no authenticated socket", async () => {
    const { recipient, sender, ping } = setup(false);
    await ping();
    expect(sender.socket.sent).toEqual([{ type: "error", code: "not_delivered" }]);
    expect([...recipient.storage.map.keys()]).toEqual(["meta:pin"]);
  });

  it("returns not_a_contact when the recipient side rejects the pair", async () => {
    const { recipient, sender, ping } = setup(true, false);
    await ping();
    expect(sender.socket.sent).toEqual([{ type: "error", code: "not_a_contact" }]);
    expect(recipient.socket.sent).toHaveLength(0);
  });

  it("relays verification_unavailable from the recipient for ping and typing", async () => {
    const { recipient, sender, ping } = setup(true, "down" as never);
    await ping();
    expect(sender.socket.sent).toEqual([{ type: "error", code: "verification_unavailable" }]);
    await (sender.mailbox as unknown as { onTyping(w: unknown, a: unknown, t: string): Promise<void> }).onTyping(
      sender.socket,
      { authenticated: true, pin: SENDER },
      RECIPIENT,
    );
    expect(sender.socket.sent[1]).toEqual({ type: "error", code: "verification_unavailable" });
    expect(recipient.socket.sent).toHaveLength(0);
  });
});
