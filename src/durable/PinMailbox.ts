import { DurableObject } from "cloudflare:workers";
import { routeFor } from "../shared/route";
import { safeLog } from "../shared/safeLog";
import { flushReceipts, purgeReceipts, receiptFrame, storeReceipt, type ReceiptKind } from "./receipts";
import { MessageIdSchema, parseFrame, PinSchema, type Envelope, type ErrorCode, type ServerMsg } from "../shared/protocol";
import { createDirectoryClientFromEnv, type DirectoryClient } from "./directoryClient";
import { holdContactBurned, isBurned, wipeMailbox } from "./burn";
import { checkInviteQuota, flushNotices, holdNotice, parseNotice } from "./notices";
import { flushPresence, parsePresence, presenceKey, retainPresence } from "./presence";
import { PairCache } from "./paircache";
import { ENVELOPE_TTL_MS, flushOutbox, runOutboxMaintenance, storeEnvelope, type StoredEnvelope } from "./outbox";
import { checkMessageRate, errorFrame, parseFailureFrame } from "./relay";
import { RateLimiter, type RateLimitResult } from "./ratelimit";
import { HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE } from "../shared/heartbeat";
import { isPushEndpoint, PUSH_THROTTLE_MS, sendWakeUp } from "../shared/push";
import { MAX_BROADCAST_ENVELOPES, PING_RATE_LIMIT, PING_RATE_WINDOW_MS } from "../shared/limits";
import { processBroadcast, type BroadcastStep } from "./broadcast";
import {
  beginConnection,
  CLOSE_POLICY,
  handleUnauthenticated,
  isExpired,
  type SocketAttachment,
} from "./handshake";

/** Injectable collaborators so the logic is testable without Neon. */
export interface PinMailboxDeps {
  directory: () => DirectoryClient;
  now: () => number;
  randomBytes: (n: number) => Uint8Array;
  /** RPC handle to another PIN's mailbox. */
  mailbox: (pin: string) => MailboxRpc;
  /** Sends an empty wake-up push; resolves with the push service's status. Null when unconfigured. */
  push: ((endpoint: string) => Promise<number>) | null;
}
/** Result of forwarding an item to the recipient's mailbox. */
export type DeliverResult = { ok: true; stored: boolean } | { ok: false; error: ErrorCode };
export interface MailboxRpc {
  deliver(item: { from: string; envelope: Envelope }): Promise<DeliverResult>;
  deliverReceipt(item: { from: string; kind: ReceiptKind; messageId: string }): Promise<{ ok: boolean }>;
  deliverTyping(item: { from: string }): Promise<{ ok: true; delivered: boolean } | { ok: false; error: ErrorCode }>;
  deliverPing(item: { from: string }): Promise<{ ok: true; delivered: boolean } | { ok: false; error: ErrorCode }>;
}
const META_PIN = "meta:pin";
const META_BURNED = "meta:burned";
const PUSH_ENDPOINT = "push:endpoint";
const PUSH_LAST = "push:last";

type MailboxEnv = Env & {
  DATABASE_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

function pushFromEnv(env: MailboxEnv): PinMailboxDeps["push"] {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const subject = env.VAPID_SUBJECT?.trim() || "mailto:push@pinme.invalid";
  return (endpoint) => sendWakeUp(endpoint, { publicKey, privateKey, subject }, Date.now());
}

export class PinMailbox extends DurableObject<MailboxEnv> {
  private readonly deps: PinMailboxDeps;
  private readonly pairCache = new PairCache();

  constructor(ctx: DurableObjectState, env: MailboxEnv, deps?: Partial<PinMailboxDeps>) {
    super(ctx, env);
    this.deps = {
      // Fresh Neon client per use; never cached across requests.
      directory: () => createDirectoryClientFromEnv(env),
      now: () => Date.now(),
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      mailbox: (pin) => env.PIN_MAILBOX.get(env.PIN_MAILBOX.idFromName(pin)) as unknown as MailboxRpc,
      push: pushFromEnv(env),
      ...deps,
    };
    // Client keepalive probes are answered by the runtime without waking this object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const route = routeFor(new URL(request.url).pathname);
    if (route.kind !== "mailbox") return new Response("Not found", { status: 404 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // Tombstone first: a burned mailbox never challenges, regardless of Directory state.
    if (await isBurned(this.ctx.storage)) {
      server.send(JSON.stringify({ type: "error", code: "pin_unavailable" }));
      server.close(CLOSE_POLICY, "unavailable");
      return new Response(null, { status: 101, webSocket: client });
    }

    const now = this.deps.now();
    const outcome = await beginConnection(route.pin, this.deps.directory(), this.deps.randomBytes, now);
    server.send(JSON.stringify(outcome.frame));
    if (outcome.kind === "reject") {
      server.close(CLOSE_POLICY, "unavailable");
    } else {
      server.serializeAttachment(outcome.attachment);
      await this.ctx.storage.put(META_PIN, route.pin);
      await this.scheduleAlarm(outcome.attachment.challengeExpiresAt);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    if (!attachment.authenticated) {
      const outcome = await handleUnauthenticated(attachment, message, this.deps.directory(), this.deps.now());
      if (outcome.kind === "authenticated") {
        ws.serializeAttachment(outcome.attachment);
        await this.flushHeldNotices(ws);
        await flushPresence(this.ctx.storage, (n) => ws.send(JSON.stringify(n)));
        await this.flushStoredEnvelopes(ws);
        await flushReceipts(this.ctx.storage, (frame) => ws.send(JSON.stringify(frame)));
      } else if (outcome.kind === "close") {
        this.sendAndClose(ws, outcome.frame);
      }
      return;
    }
    const parsed = parseFrame(message, "client");
    if (!parsed.ok) {
      if (
        parsed.reason === "validation_failed" &&
        parsed.type === "broadcast" &&
        parsed.field === "envelopes" &&
        this.broadcastCount(message) > MAX_BROADCAST_ENVELOPES
      ) {
        this.sendFrame(ws, errorFrame("envelope_limit_exceeded", { field: "envelopes" }));
        return;
      }
      this.sendFrame(ws, parseFailureFrame(parsed));
      return;
    }
    if (parsed.value.type === "message") {
      await this.onMessage(ws, attachment, parsed.value.envelope);
    } else if (parsed.value.type === "delivered" || parsed.value.type === "read") {
      await this.onReceipt(attachment, parsed.value.type, parsed.value.to, parsed.value.messageId);
    } else if (parsed.value.type === "typing") {
      await this.onTyping(ws, attachment, parsed.value.to);
    } else if (parsed.value.type === "ping") {
      await this.onPing(ws, attachment, parsed.value.to);
    }
    else if (parsed.value.type === "broadcast") {
      await this.onBroadcast(ws, attachment, parsed.value.envelopes);
    }
  }

  /** Number of envelopes in a raw broadcast frame (0 if unreadable). */
  private broadcastCount(message: string | ArrayBuffer): number {
    try {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      const v = JSON.parse(raw) as { envelopes?: unknown };
      return Array.isArray(v.envelopes) ? v.envelopes.length : 0;
    } catch {
      return 0;
    }
  }

  /** Sender-side receipt relay (Req 8.7, 8.8): non-contacts are discarded silently. */
  private async onReceipt(att: SocketAttachment, kind: ReceiptKind, to: string, messageId: string): Promise<void> {
    const directory = this.deps.directory();
    const verdict = await this.pairCache.check(to, this.deps.now(), (other) => directory.isContactPair(att.pin, other));
    if (!verdict.ok) return;
    try {
      await this.deps.mailbox(to).deliverReceipt({ from: att.pin, kind, messageId });
    } catch {
      safeLog("deliver_failed");
    }
  }

  /** Sender-side typing relay (Req 10.6, 10.7): error to sender only when the pair check fails. */
  private async onTyping(ws: WebSocket, att: SocketAttachment, to: string): Promise<void> {
    const directory = this.deps.directory();
    const verdict = await this.pairCache.check(to, this.deps.now(), (other) => directory.isContactPair(att.pin, other));
    if (!verdict.ok) {
      this.sendFrame(ws, errorFrame(verdict.error === "verification_unavailable" ? verdict.error : "not_a_contact"));
      return;
    }
    let result: Awaited<ReturnType<MailboxRpc["deliverTyping"]>>;
    try {
      result = await this.deps.mailbox(to).deliverTyping({ from: att.pin });
    } catch {
      safeLog("deliver_failed");
      return;
    }
    if (!result.ok && (result.error === "not_a_contact" || result.error === "verification_unavailable")) {
      this.sendFrame(ws, errorFrame(result.error));
    }
  }

  /**
   * Sender-side ping relay (Req 9.4, 9.5, 9.7, 9.8): contacts only, 1 per 10 s per contact,
   * never stored; sender gets not_delivered when the recipient has no authenticated socket.
   */
  private async onPing(ws: WebSocket, att: SocketAttachment, to: string): Promise<void> {
    const now = this.deps.now();
    const directory = this.deps.directory();
    const verdict = await this.pairCache.check(to, now, (other) => directory.isContactPair(att.pin, other));
    if (!verdict.ok) {
      this.sendFrame(ws, errorFrame(verdict.error === "verification_unavailable" ? verdict.error : "not_a_contact"));
      return;
    }
    const key = `rl:ping:${to}`;
    const limiter = new RateLimiter({ [key]: (await this.ctx.storage.get<number[]>(key)) ?? [] });
    const rate = limiter.allow(key, now, PING_RATE_LIMIT, PING_RATE_WINDOW_MS);
    limiter.prune(now, PING_RATE_WINDOW_MS);
    const hits = limiter.snapshot()[key];
    if (hits) await this.ctx.storage.put(key, hits);
    else await this.ctx.storage.delete(key);
    if (!rate.ok) {
      this.sendFrame(ws, errorFrame("rate_limited", { retryAfterMs: rate.retryAfterMs }));
      return;
    }
    let result: Awaited<ReturnType<MailboxRpc["deliverPing"]>>;
    try {
      result = await this.deps.mailbox(to).deliverPing({ from: att.pin });
    } catch {
      safeLog("deliver_failed");
      this.sendFrame(ws, errorFrame("not_delivered"));
      return;
    }
    if (!result.ok) {
      const code = result.error === "not_a_contact" || result.error === "verification_unavailable" ? result.error : "not_delivered";
      this.sendFrame(ws, errorFrame(code));
    } else if (!result.delivered) {
      this.sendFrame(ws, errorFrame("not_delivered"));
    }
  }

  /** RPC: relays a ping to authenticated sockets after independent pair verification. Never stored. */
  async deliverPing(item: { from: string }): Promise<{ ok: true; delivered: boolean } | { ok: false; error: ErrorCode }> {
    if (!PinSchema.safeParse(item.from).success) return { ok: false, error: "validation_failed" };
    if (await this.ctx.storage.get(META_BURNED)) return { ok: false, error: "pin_burned" };
    const myPin = await this.ctx.storage.get<string>(META_PIN);
    if (!myPin) return { ok: false, error: "pin_unavailable" };
    const directory = this.deps.directory();
    const verdict = await this.pairCache.check(item.from, this.deps.now(), (other) => directory.isContactPair(other, myPin));
    if (!verdict.ok) return { ok: false, error: verdict.error };
    const delivered = this.sendToAuthenticated(JSON.stringify({ type: "ping", from: item.from }));
    return { ok: true, delivered };
  }

  /**
   * RPC: relays a delivered/read receipt after re-verifying the pair independently.
   * Online: sent to every authenticated socket. Offline: stored under `rcpt:*` until next auth.
   */
  async deliverReceipt(item: { from: string; kind: ReceiptKind; messageId: string }): Promise<{ ok: boolean }> {
    if (
      !PinSchema.safeParse(item.from).success ||
      (item.kind !== "delivered" && item.kind !== "read") ||
      !MessageIdSchema.safeParse(item.messageId).success
    ) {
      return { ok: false };
    }
    const now = this.deps.now();
    if (await this.ctx.storage.get(META_BURNED)) return { ok: false };
    const myPin = await this.ctx.storage.get<string>(META_PIN);
    if (!myPin) return { ok: false };
    const directory = this.deps.directory();
    const verdict = await this.pairCache.check(item.from, now, (other) => directory.isContactPair(other, myPin));
    if (!verdict.ok) return { ok: false };
    if (this.sendToAuthenticated(JSON.stringify(receiptFrame(item)))) return { ok: true };
    await storeReceipt(this.ctx.storage, { ...item, storedAt: now }, crypto.randomUUID());
    await this.scheduleAlarm(now + ENVELOPE_TTL_MS + 1);
    return { ok: true };
  }

  /** RPC: relays a typing frame to authenticated sockets. Never stored; silent when offline. */
  async deliverTyping(item: { from: string }): Promise<{ ok: true; delivered: boolean } | { ok: false; error: ErrorCode }> {
    if (!PinSchema.safeParse(item.from).success) return { ok: false, error: "validation_failed" };
    if (await this.ctx.storage.get(META_BURNED)) return { ok: false, error: "pin_burned" };
    const myPin = await this.ctx.storage.get<string>(META_PIN);
    if (!myPin) return { ok: false, error: "pin_unavailable" };
    const directory = this.deps.directory();
    const verdict = await this.pairCache.check(item.from, this.deps.now(), (other) => directory.isContactPair(other, myPin));
    if (!verdict.ok) return { ok: false, error: verdict.error };
    const delivered = this.sendToAuthenticated(JSON.stringify({ type: "typing", from: item.from }));
    return { ok: true, delivered };
  }

  /** Sends to every authenticated socket; true if at least one send succeeded. */
  private sendToAuthenticated(frame: string): boolean {
    let delivered = false;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att?.authenticated) continue;
      try {
        ws.send(frame);
        delivered = true;
      } catch {
        safeLog("send_failed");
      }
    }
    return delivered;
  }

  /** Sender-side relay: rate limit, burned and contacts-only checks, then forward (Req 7.3, 7.9, 7.10, 16.1, 16.3). */
  private async onMessage(ws: WebSocket, att: SocketAttachment, envelope: Envelope): Promise<void> {
    const ref = envelope.messageId;
    const rate = await checkMessageRate(this.ctx.storage, att.pin, this.deps.now());
    if (!rate.ok) {
      this.sendFrame(ws, errorFrame("rate_limited", { ref, retryAfterMs: rate.retryAfterMs }));
      return;
    }
    const gate = await this.checkEnvelopeRecipient(att, envelope);
    if (!gate.ok) {
      this.sendFrame(ws, errorFrame(gate.error, { ref }));
      return;
    }
    const result = await this.forwardEnvelope(att, envelope);
    if (!result.ok) this.sendFrame(ws, errorFrame(result.error, { ref }));
  }

  /** Shared per-envelope gate: burned check (best effort) then contacts-only pair check. */
  private async checkEnvelopeRecipient(att: SocketAttachment, envelope: Envelope): Promise<BroadcastStep> {
    const now = this.deps.now();
    const directory = this.deps.directory();
    // Burned check is best effort: if the Directory is down, the pair check below still fails closed
    // unless the pair is cached, and the recipient mailbox rejects burned state itself.
    const record = await directory.lookupPin(envelope.to).catch(() => null);
    if (record?.state === "burned") return { ok: false, error: "pin_burned" };
    const verdict = await this.pairCache.check(envelope.to, now, (other) => directory.isContactPair(att.pin, other));
    return verdict.ok ? { ok: true } : { ok: false, error: verdict.error };
  }

  /** Shared per-envelope deliver RPC; failures fail closed. */
  private async forwardEnvelope(att: SocketAttachment, envelope: Envelope): Promise<BroadcastStep> {
    try {
      const result = await this.deps.mailbox(envelope.to).deliver({ from: att.pin, envelope });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    } catch {
      safeLog("deliver_failed");
      return { ok: false, error: "verification_unavailable" };
    }
  }

  /** Broadcast relay (Req 12.3, 12.6-12.8, 12.10): same per-envelope path as onMessage. */
  private async onBroadcast(ws: WebSocket, att: SocketAttachment, envelopes: Envelope[]): Promise<void> {
    const result = await processBroadcast(envelopes, {
      checkContact: (env) => this.checkEnvelopeRecipient(att, env),
      consumeRate: () => checkMessageRate(this.ctx.storage, att.pin, this.deps.now()),
      forward: (env) => this.forwardEnvelope(att, env),
    });
    for (const e of result.errors) {
      const frame = errorFrame(e.code, { ref: e.ref, retryAfterMs: e.retryAfterMs });
      if (e.to && frame.type === "error") frame.to = e.to;
      this.sendFrame(ws, frame);
    }
  }

  /**
   * RPC from another mailbox: re-verifies the Contact pair independently (Req 16.4),
   * then delivers to every authenticated socket or stores the envelope (Req 7.4, 7.5).
   */
  async deliver(item: { from: string; envelope: Envelope }): Promise<DeliverResult> {
    const parsed = parseFrame({ type: "message", envelope: item.envelope }, "client");
    if (!parsed.ok || parsed.value.type !== "message" || !PinSchema.safeParse(item.from).success) {
      return { ok: false, error: "validation_failed" };
    }
    const envelope = parsed.value.envelope;
    const now = this.deps.now();
    if (await this.ctx.storage.get(META_BURNED)) return { ok: false, error: "pin_burned" };
    const myPin = await this.ctx.storage.get<string>(META_PIN);
    if (!myPin) return { ok: false, error: "pin_unavailable" };
    const directory = this.deps.directory();
    const verdict = await this.pairCache.check(item.from, now, (other) => directory.isContactPair(other, myPin));
    if (!verdict.ok) return { ok: false, error: verdict.error };
    const frame = JSON.stringify({ type: "message", from: item.from, envelope });
    let delivered = false;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att?.authenticated) continue;
      try {
        ws.send(frame);
        delivered = true;
      } catch {
        safeLog("send_failed");
      }
    }
    if (delivered) return { ok: true, stored: false };
    const rec: StoredEnvelope = { from: item.from, envelope, storedAt: now };
    await storeEnvelope(this.ctx.storage, rec);
    await this.scheduleAlarm(now + ENVELOPE_TTL_MS + 1);
    this.wakeUp();
    return { ok: true, stored: true };
  }

  private async flushStoredEnvelopes(ws: WebSocket): Promise<void> {
    const now = this.deps.now();
    const { wake } = await flushOutbox(
      this.ctx.storage,
      (from, envelope) => ws.send(JSON.stringify({ type: "message", from, envelope })),
      now,
    );
    if (wake !== null) await this.scheduleAlarm(wake);
  }

  private sendFrame(ws: WebSocket, frame: ServerMsg): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      safeLog("send_failed");
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    // 1005/1006 are reserved and cannot be sent in a close frame.
    const safe = code === 1005 || code === 1006 ? 1000 : code;
    try {
      ws.close(safe);
    } catch {
      safeLog("close_failed");
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011);
    } catch {
      safeLog("close_failed");
    }
  }

  /** Closes expired unauthenticated sockets, purges 30-day-old envelopes, retries deletes, reschedules. */
  async alarm(): Promise<void> {
    if (await isBurned(this.ctx.storage)) return;
    const now = this.deps.now();
    let next: number | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att || att.authenticated) continue;
      if (isExpired(att, now)) {
        this.sendAndClose(ws, { type: "error", code: "invalid_signature" });
      } else if (next === null || att.challengeExpiresAt < next) {
        next = att.challengeExpiresAt;
      }
    }
    const outboxWake = await runOutboxMaintenance(this.ctx.storage, now);
    if (outboxWake !== null && (next === null || outboxWake < next)) next = outboxWake;
    const receiptWake = await purgeReceipts(this.ctx.storage, now);
    if (receiptWake !== null && (next === null || receiptWake < next)) next = receiptWake;
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  /** RPC: consumes one invite slot for this PIN (10 per 60 min, persisted). */
  async checkInviteQuota(): Promise<RateLimitResult> {
    return checkInviteQuota(this.ctx.storage, this.deps.now());
  }

  /**
   * RPC: delivers an invite/accepted notice to authenticated sockets now,
   * otherwise holds it under `notice:*` until the next authentication.
   */
  async pushNotice(notice: unknown): Promise<{ delivered: boolean }> {
    const parsed = parseNotice(notice);
    if (!parsed) throw new Error("invalid_notice");
    const frame = JSON.stringify(parsed);
    let delivered = false;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att?.authenticated) continue;
      try {
        ws.send(frame);
        delivered = true;
      } catch {
        safeLog("send_failed");
      }
    }
    if (!delivered) {
      await holdNotice(this.ctx.storage, parsed, this.deps.now(), crypto.randomUUID());
      this.wakeUp();
    }
    return { delivered };
  }

  /**
   * RPC: pushes a presence update (Req 11.6, 11.7). Sent to authenticated sockets now;
   * with none connected, the latest per sender is retained under `presence:{from}`
   * and delivered (then deleted) after the next authentication.
   */
  async pushPresence(notice: unknown): Promise<{ delivered: boolean }> {
    const parsed = parsePresence(notice);
    if (!parsed) throw new Error("invalid_notice");
    const delivered = this.sendToAuthenticated(JSON.stringify(parsed));
    if (delivered) {
      // A stale retained item must not overwrite this newer one on a later connect.
      await this.ctx.storage.delete(presenceKey(parsed.from));
    } else {
      await retainPresence(this.ctx.storage, parsed);
    }
    return { delivered };
  }

  /**
   * RPC (Req 13.5, 13.9): closes all sockets, wipes every stored key and alarm,
   * keeps only the `meta:burned` tombstone. Idempotent.
   */
  async burn(): Promise<{ ok: true }> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_POLICY, "burned");
      } catch {
        safeLog("close_failed");
      }
    }
    this.pairCache.invalidate();
    await wipeMailbox(this.ctx.storage);
    return { ok: true };
  }

  /**
   * RPC (Req 13.11): a contact's PIN was burned. Pushed to authenticated sockets now,
   * otherwise held under `notice:*` until next authentication. Pair cache is invalidated.
   */
  async contactBurned(pin: string): Promise<{ delivered: boolean }> {
    if (!PinSchema.safeParse(pin).success) throw new Error("invalid_notice");
    this.pairCache.invalidate();
    if (await isBurned(this.ctx.storage)) return { delivered: false };
    const delivered = this.sendToAuthenticated(JSON.stringify({ type: "contactBurned", pin }));
    if (!delivered) await holdContactBurned(this.ctx.storage, pin, this.deps.now(), crypto.randomUUID());
    return { delivered };
  }

  /**
   * RPC (push): stores or clears this PIN's single push endpoint. Endpoints outside the known
   * push services are refused, so the mailbox never POSTs to an arbitrary URL.
   */
  async setPushEndpoint(endpoint: string | null): Promise<{ ok: boolean }> {
    if (await isBurned(this.ctx.storage)) return { ok: false };
    if (endpoint === null) {
      await this.ctx.storage.delete(PUSH_ENDPOINT);
      return { ok: true };
    }
    if (!isPushEndpoint(endpoint)) return { ok: false };
    await this.ctx.storage.put(PUSH_ENDPOINT, endpoint);
    return { ok: true };
  }

  /**
   * Something is waiting and no socket is authenticated: send one empty wake-up, at most once per
   * PUSH_THROTTLE_MS. Runs after the response; a gone subscription (404/410) is forgotten.
   */
  private wakeUp(): void {
    const push = this.deps.push;
    if (!push) return;
    this.ctx.waitUntil(
      (async () => {
        const endpoint = await this.ctx.storage.get<string>(PUSH_ENDPOINT);
        if (!endpoint) return;
        const now = this.deps.now();
        const last = (await this.ctx.storage.get<number>(PUSH_LAST)) ?? 0;
        if (now - last < PUSH_THROTTLE_MS) return;
        await this.ctx.storage.put(PUSH_LAST, now);
        const status = await push(endpoint);
        if (status === 404 || status === 410) await this.ctx.storage.delete(PUSH_ENDPOINT);
        else if (status >= 400) safeLog("push_failed");
      })().catch(() => safeLog("push_failed")),
    );
  }

  /** RPC: the contact set changed, so cached pair verdicts must not be reused. */
  invalidatePairs(): void {
    this.pairCache.invalidate();
  }

  private async flushHeldNotices(ws: WebSocket): Promise<void> {
    await flushNotices(this.ctx.storage, (notice) => ws.send(JSON.stringify(notice)));
  }

  private sendAndClose(ws: WebSocket, frame: ServerMsg): void {
    try {
      ws.send(JSON.stringify(frame));
      ws.close(CLOSE_POLICY, "unauthenticated");
    } catch {
      safeLog("close_failed");
    }
  }

  /** Sets the alarm to the earlier of the existing alarm and `at`. */
  private async scheduleAlarm(at: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > at) await this.ctx.storage.setAlarm(at);
  }
}
