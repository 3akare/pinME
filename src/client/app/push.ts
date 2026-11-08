import { bytesToBase64, base64ToBytes } from "../../shared/base64";
import { ready, randomBytes, signRequest } from "../crypto";
import type { PinRecord } from "../storage";
import { getPushConfigFn, registerPushFn } from "../../server/functions/push";

/**
 * Each own PIN subscribes from its own service-worker scope, so every PIN has a different push
 * endpoint and the server cannot link one person's PINs through push. The worker script is the
 * same `/sw.js`; only the scope differs.
 */
export const scopeFor = (pin: string): string => `/push/${pin}/`;

export type PushState = "unsupported" | "unconfigured" | "off" | "on" | "blocked";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Registers the root worker that makes the app installable. Safe to call repeatedly. */
export async function registerAppWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
}

let keyPromise: Promise<string | null> | null = null;
function vapidKey(): Promise<string | null> {
  keyPromise ??= getPushConfigFn()
    .then((r) => r.publicKey)
    .catch(() => {
      keyPromise = null;
      return null;
    });
  return keyPromise;
}

async function sendEndpoint(pin: PinRecord, endpoint: string | null): Promise<boolean> {
  await ready();
  const fields = {
    pin: pin.pin,
    action: "registerPush" as const,
    ts: Date.now(),
    nonce: bytesToBase64(randomBytes(16)),
    payload: { endpoint },
  };
  const res = (await registerPushFn({
    data: { ...fields, signature: bytesToBase64(signRequest(fields, pin.signSk)) },
  })) as { ok: boolean };
  return res.ok;
}

/** Subscribes one PIN (reusing an existing subscription) and tells its mailbox where to wake it. */
async function subscribePin(pin: PinRecord, key: string): Promise<boolean> {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: scopeFor(pin.pin) });
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(key) as BufferSource }));
  return sendEndpoint(pin, sub.endpoint);
}

export async function pushState(pins: readonly PinRecord[]): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!(await vapidKey())) return "unconfigured";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const active = pins.filter((p) => p.status === "active");
  for (const p of active) {
    const reg = await navigator.serviceWorker.getRegistration(scopeFor(p.pin));
    if (!(await reg?.pushManager.getSubscription())) return "off";
  }
  return active.length > 0 ? "on" : "off";
}

/** Asks for permission (needs a user gesture) and subscribes every active PIN. */
export async function enablePush(pins: readonly PinRecord[]): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const key = await vapidKey();
  if (!key) return "unconfigured";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  await syncPush(pins);
  return pushState(pins);
}

/** On start-up with permission already granted: subscribe any PIN that is missing (new PINs). */
export async function syncPush(pins: readonly PinRecord[]): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const key = await vapidKey();
  if (!key) return;
  for (const p of pins.filter((x) => x.status === "active")) {
    await subscribePin(p, key).catch(() => false);
  }
}

/** Turns pushes off for every PIN: unsubscribes and clears each mailbox's endpoint. */
export async function disablePush(pins: readonly PinRecord[]): Promise<void> {
  if (!pushSupported()) return;
  for (const p of pins) {
    const reg = await navigator.serviceWorker.getRegistration(scopeFor(p.pin));
    await reg?.pushManager.getSubscription().then((s) => s?.unsubscribe());
    await reg?.unregister();
    if (p.status === "active") await sendEndpoint(p, null).catch(() => false);
  }
}

/** A burned PIN's mailbox is wiped server-side; drop its local worker and subscription too. */
export async function forgetPush(pin: string): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration(scopeFor(pin));
  await reg?.pushManager.getSubscription().then((s) => s?.unsubscribe());
  await reg?.unregister();
}
