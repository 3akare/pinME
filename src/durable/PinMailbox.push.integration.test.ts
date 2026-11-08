/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PUSH_THROTTLE_MS } from "../shared/push";
import { PinMailbox, type PinMailboxDeps } from "./PinMailbox";

const OWN = "AAAAAAAA";
const PEER = "BBBBBBBB";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const NONCE = "A".repeat(32);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function makeMailbox(status = 201) {
  const real = await runInDurableObject(env.PIN_MAILBOX.get(env.PIN_MAILBOX.newUniqueId()), (_i, state) => state);
  const map = new Map<string, unknown>([["meta:pin", OWN]]);
  const pending: Promise<unknown>[] = [];
  const storage = {
    get: async (k: string) => map.get(k),
    put: async (k: string, v: unknown) => void map.set(k, v),
    delete: async (k: string) => map.delete(k),
    list: async ({ prefix }: { prefix: string }) => new Map([...map].filter(([k]) => k.startsWith(prefix))),
    getAlarm: async () => null,
    setAlarm: async () => {},
  };
  const ctx = { storage, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  let clock = 1_000_000;
  const pushed: string[] = [];
  const deps: Partial<PinMailboxDeps> = {
    now: () => clock,
    directory: () => ({ isContactPair: async () => true, mayRelay: async () => true, lookupPin: async () => ({ state: "active" }) }) as never,
    push: async (endpoint) => {
      pushed.push(endpoint);
      return status;
    },
  };
  const mailbox = new PinMailbox(real, env as never, deps);
  Object.defineProperty(mailbox, "ctx", { value: ctx, configurable: true });
  const deliver = (n: number) =>
    mailbox.deliver({ from: PEER, envelope: { to: OWN, messageId: uuid(n), nonce: NONCE, ciphertext: "AAAA" } });
  return {
    map,
    mailbox,
    pushed,
    deliver,
    settle: () => Promise.all(pending.splice(0)),
    advance: (ms: number) => void (clock += ms),
  };
}

describe("PinMailbox wake-up pushes", () => {
  it("refuses endpoints outside the known push services", async () => {
    const h = await makeMailbox();
    expect(await h.mailbox.setPushEndpoint("https://evil.example/collect")).toEqual({ ok: false });
    expect(await h.mailbox.setPushEndpoint("http://fcm.googleapis.com/x")).toEqual({ ok: false });
    expect(h.map.has("push:endpoint")).toBe(false);
  });

  it("wakes an offline PIN once per window when messages are held, and never when no endpoint is set", async () => {
    const h = await makeMailbox();
    await h.deliver(1);
    await h.settle();
    expect(h.pushed).toEqual([]);

    expect(await h.mailbox.setPushEndpoint(ENDPOINT)).toEqual({ ok: true });
    await h.deliver(2);
    await h.deliver(3);
    await h.settle();
    expect(h.pushed).toEqual([ENDPOINT]);

    h.advance(PUSH_THROTTLE_MS);
    await h.deliver(4);
    await h.settle();
    expect(h.pushed).toHaveLength(2);
  });

  it("forgets an endpoint the push service says is gone", async () => {
    const h = await makeMailbox(410);
    await h.mailbox.setPushEndpoint(ENDPOINT);
    await h.deliver(1);
    await h.settle();
    expect(h.map.has("push:endpoint")).toBe(false);
  });

  it("clears the endpoint when turned off", async () => {
    const h = await makeMailbox();
    await h.mailbox.setPushEndpoint(ENDPOINT);
    expect(await h.mailbox.setPushEndpoint(null)).toEqual({ ok: true });
    expect(h.map.has("push:endpoint")).toBe(false);
  });
});
