/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { base64ToBytes, bytesToBase64 } from "../shared/base64";
import { ACTIVE_PIN, BURNED_PIN, UNKNOWN_PIN, testKeys } from "../../test/workers/keys";
import type { SocketAttachment } from "./handshake";

interface Client {
  ws: WebSocket;
  frames: Record<string, unknown>[];
  closed: Promise<number>;
  next(): Promise<Record<string, unknown>>;
}

async function connect(pin: string): Promise<Client> {
  const res = await exports.default.fetch(`https://example.com/ws/${pin}`, {
    headers: { Upgrade: "websocket" },
  });
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
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
  ws.accept();
  return {
    ws,
    frames,
    closed,
    next: () => (frames.length ? Promise.resolve(frames.shift()!) : new Promise((r) => waiters.push(r))),
  };
}

async function sign(seed: number, challengeB64: string): Promise<string> {
  const { privateKey } = await testKeys(seed);
  const sig = await crypto.subtle.sign("Ed25519", privateKey, base64ToBytes(challengeB64) as BufferSource);
  return bytesToBase64(new Uint8Array(sig));
}

const stubFor = (pin: string) => env.PIN_MAILBOX.get(env.PIN_MAILBOX.idFromName(pin));

async function attachments(pin: string): Promise<SocketAttachment[]> {
  return runInDurableObject(stubFor(pin), (_i, state) =>
    state.getWebSockets().map((w) => w.deserializeAttachment() as SocketAttachment),
  );
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fn();
}

afterEach(() => {
  vi.useRealTimers();
});

// Validates: Requirements 6.5, 6.6, 6.7, 6.9, 6.12
describe("PinMailbox handshake", () => {
  it("authenticates a valid challenge response (6.5)", async () => {
    const c = await connect(ACTIVE_PIN);
    const challenge = await c.next();
    expect(challenge.type).toBe("challenge");
    expect(base64ToBytes(challenge.challenge as string)).toHaveLength(32);

    c.ws.send(JSON.stringify({ type: "challengeResponse", signature: await sign(1, challenge.challenge as string) }));
    const atts = await waitFor(
      () => attachments(ACTIVE_PIN),
      (a) => a.some((x) => x.authenticated),
    );
    expect(atts.some((a) => a.authenticated)).toBe(true);
    c.ws.close(1000);
  });

  it("closes on an invalid signature (6.6)", async () => {
    const c = await connect(ACTIVE_PIN);
    const challenge = await c.next();
    c.ws.send(JSON.stringify({ type: "challengeResponse", signature: await sign(2, challenge.challenge as string) }));
    expect(await c.next()).toEqual({ type: "error", code: "invalid_signature" });
    expect(await c.closed).toBe(1008);
  });

  it("closes an unauthenticated socket after 10 s (6.7)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const c = await connect(ACTIVE_PIN);
    expect((await c.next()).type).toBe("challenge");

    vi.setSystemTime(new Date("2030-01-01T00:00:09Z"));
    await runDurableObjectAlarm(stubFor(ACTIVE_PIN));
    expect((await attachments(ACTIVE_PIN)).length).toBeGreaterThan(0);

    vi.setSystemTime(new Date("2030-01-01T00:00:10Z"));
    await runDurableObjectAlarm(stubFor(ACTIVE_PIN));
    expect(await c.next()).toEqual({ type: "error", code: "invalid_signature" });
    expect(await c.closed).toBe(1008);
  });

  it.each([
    ["burned", BURNED_PIN],
    ["unknown", UNKNOWN_PIN],
  ])("sends pin_unavailable and no challenge for a %s PIN (6.9)", async (_label, pin) => {
    const c = await connect(pin);
    expect(await c.next()).toEqual({ type: "error", code: "pin_unavailable" });
    await c.closed;
    expect(c.frames.filter((f) => f.type === "challenge")).toHaveLength(0);
  });

  it("resumes the handshake after hibernation eviction (6.12)", async () => {
    const c = await connect(ACTIVE_PIN);
    const challenge = await c.next();
    await evictDurableObject(stubFor(ACTIVE_PIN));

    c.ws.send(JSON.stringify({ type: "challengeResponse", signature: await sign(1, challenge.challenge as string) }));
    const atts = await waitFor(
      () => attachments(ACTIVE_PIN),
      (a) => a.some((x) => x.authenticated),
    );
    expect(atts.some((a) => a.authenticated)).toBe(true);
    c.ws.close(1000);
  });
});
