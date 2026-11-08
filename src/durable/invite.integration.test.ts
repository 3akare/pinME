/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "../shared/base64";
import { ACTIVE_PIN, INVITE_TEST_PIN_B, INVITE_TEST_SEED_B, testKeys } from "../../test/workers/keys";
import type { SocketAttachment } from "./handshake";

interface Client {
  ws: WebSocket;
  frames: Record<string, unknown>[];
  next(): Promise<Record<string, unknown>>;
}

async function connect(pin: string): Promise<Client> {
  const res = await exports.default.fetch(`https://example.com/ws/${pin}`, { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const frames: Record<string, unknown>[] = [];
  const waiters: ((f: Record<string, unknown>) => void)[] = [];
  ws.addEventListener("message", (e) => {
    const frame = JSON.parse(e.data as string) as Record<string, unknown>;
    const w = waiters.shift();
    if (w) w(frame);
    else frames.push(frame);
  });
  ws.accept();
  return {
    ws,
    frames,
    next: () => (frames.length ? Promise.resolve(frames.shift()!) : new Promise((r) => waiters.push(r))),
  };
}

const stubFor = (pin: string) => env.PIN_MAILBOX.get(env.PIN_MAILBOX.idFromName(pin));

async function authenticate(pin: string, seed: number): Promise<Client> {
  const c = await connect(pin);
  const challenge = await c.next();
  expect(challenge.type).toBe("challenge");
  const { privateKey } = await testKeys(seed);
  const sig = await crypto.subtle.sign("Ed25519", privateKey, base64ToBytes(challenge.challenge as string) as BufferSource);
  c.ws.send(JSON.stringify({ type: "challengeResponse", signature: bytesToBase64(new Uint8Array(sig)) }));
  for (let i = 0; i < 100; i++) {
    const atts = await runInDurableObject(stubFor(pin), (_i, state) =>
      state.getWebSockets().map((w) => w.deserializeAttachment() as SocketAttachment),
    );
    if (atts.some((a) => a.authenticated)) return c;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("authentication did not complete");
}

const PIN_A = ACTIVE_PIN;
const PIN_B = INVITE_TEST_PIN_B;
const B_SEED = INVITE_TEST_SEED_B;

// Validates: Requirements 4.2, 4.3, 4.4
describe("invite flow across two mailboxes", () => {
  it("delivers an inviteNotice immediately to an online recipient (4.2)", async () => {
    const b = await authenticate(PIN_B, B_SEED);
    const inviteId = crypto.randomUUID();

    const result = await stubFor(PIN_B).pushNotice({ type: "inviteNotice", kind: "invite", from: PIN_A, inviteId });

    expect(result).toEqual({ delivered: true });
    expect(await b.next()).toEqual({ type: "inviteNotice", kind: "invite", from: PIN_A, inviteId });
    b.ws.close(1000);
  });

  it("holds a notice for an offline recipient and delivers it after authentication (4.3)", async () => {
    const inviteId = crypto.randomUUID();

    const result = await stubFor(PIN_B).pushNotice({ type: "inviteNotice", kind: "invite", from: PIN_A, inviteId });
    expect(result).toEqual({ delivered: false });

    const held = await runInDurableObject(stubFor(PIN_B), (_i, state) => state.storage.list({ prefix: "notice:" }));
    expect(held.size).toBe(1);

    const b = await authenticate(PIN_B, B_SEED);
    expect(await b.next()).toEqual({ type: "inviteNotice", kind: "invite", from: PIN_A, inviteId });

    const after = await runInDurableObject(stubFor(PIN_B), (_i, state) => state.storage.list({ prefix: "notice:" }));
    expect(after.size).toBe(0);
    b.ws.close(1000);
  });

  it("notifies the online inviter when the invite is accepted (4.4)", async () => {
    const a = await authenticate(PIN_A, 1);
    const inviteId = crypto.randomUUID();

    // B accepts: the server pushes an `accepted` notice from B to the inviter A's mailbox.
    const result = await stubFor(PIN_A).pushNotice({ type: "inviteNotice", kind: "accepted", from: PIN_B, inviteId });

    expect(result).toEqual({ delivered: true });
    expect(await a.next()).toEqual({ type: "inviteNotice", kind: "accepted", from: PIN_B, inviteId });
    a.ws.close(1000);
  });

  it("holds the accepted notice for an offline inviter until it connects (4.4)", async () => {
    const inviteId = crypto.randomUUID();
    const result = await stubFor(PIN_A).pushNotice({ type: "inviteNotice", kind: "accepted", from: PIN_B, inviteId });
    expect(result).toEqual({ delivered: false });

    const a = await authenticate(PIN_A, 1);
    expect(await a.next()).toEqual({ type: "inviteNotice", kind: "accepted", from: PIN_B, inviteId });
    a.ws.close(1000);
  });
});
