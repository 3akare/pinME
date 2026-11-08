import { describe, expect, it, vi } from "vitest";
import { base64ToBytes } from "./base64";
import { isPushEndpoint, sendWakeUp, vapidAuthorization } from "./push";

async function keys() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const b = (u: Uint8Array) => Buffer.from(u).toString("base64url");
  return { publicKey: b(raw), privateKey: jwk.d!, subject: "mailto:ops@pinme.invalid", verifyKey: kp.publicKey };
}

describe("push endpoints", () => {
  it("accepts only https endpoints on known push services", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    for (const bad of [
      "http://fcm.googleapis.com/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com.example/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://169.254.169.254/latest",
      "not a url",
      42,
    ]) {
      expect(isPushEndpoint(bad), String(bad)).toBe(false);
    }
  });
});

describe("VAPID", () => {
  it("signs a JWT for the endpoint's origin that verifies with the public key", async () => {
    const k = await keys();
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/x", k, 1_700_000_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(k.publicKey);
    const claims = JSON.parse(Buffer.from(m[2]!, "base64url").toString());
    expect(claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: k.subject, exp: 1_700_000_000 + 43_200 });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      k.verifyKey,
      base64ToBytes(m[3]!) as BufferSource,
      new TextEncoder().encode(`${m[1]}.${m[2]}`),
    );
    expect(ok).toBe(true);
  });

  it("sends an empty wake-up with TTL and urgency", async () => {
    const k = await keys();
    const fetchFn = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendWakeUp("https://fcm.googleapis.com/fcm/send/x", k, 1_700_000_000_000, fetchFn)).toBe(201);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({ TTL: "86400", Urgency: "high", "Content-Length": "0" });
  });
});
