import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { IdentityRecord, PinRecord } from "../storage";
import { completeOnboarding, type CompleteOnboardingDeps } from "./complete";
import {
  DISPLAY_NAME_MESSAGE,
  PICTURE_MAX_BYTES,
  PICTURE_MESSAGE,
  validateOnboarding,
  validatePicture,
} from "./form";

const pic = (size: number, type = "image/png") => ({ size, type }) as Blob & { size: number; type: string };

function setup(registerOk = true) {
  const writes: Array<{ identity: IdentityRecord; pin: PinRecord }> = [];
  let ctr = 0;
  const deps: CompleteOnboardingDeps = {
    randomBytes: (n) => new Uint8Array(n).fill(++ctr),
    generatePinKeys: () => ({
      box: { publicKey: new Uint8Array(32).fill(1), privateKey: new Uint8Array(32).fill(1) },
      sign: { publicKey: new Uint8Array(32).fill(1), privateKey: new Uint8Array(64).fill(1) },
    }),
    registerPin: async () => (registerOk ? { ok: true } : { ok: false, code: "internal" }),
    saveIdentityAndPin: async (identity, pin) => void writes.push({ identity, pin }),
  };
  return { deps, writes };
}

describe("picture validation (Req 1.6, 1.7)", () => {
  it("accepts exactly 256 KB", () => {
    expect(PICTURE_MAX_BYTES).toBe(262144);
    expect(validatePicture(pic(PICTURE_MAX_BYTES))).toBeUndefined();
  });
  it("rejects 256 KB + 1", () => {
    expect(validatePicture(pic(PICTURE_MAX_BYTES + 1))).toBe(PICTURE_MESSAGE);
  });
  it("rejects non-image types", () => {
    expect(validatePicture(pic(10, "application/pdf"))).toBe(PICTURE_MESSAGE);
    expect(validatePicture(pic(10, ""))).toBe(PICTURE_MESSAGE);
  });
  it("treats a missing picture as valid", () => {
    expect(validatePicture(null)).toBeUndefined();
    expect(validatePicture(undefined)).toBeUndefined();
  });
});

describe("validateOnboarding", () => {
  it("trims the display name and accepts a valid form", () => {
    const r = validateOnboarding({ displayName: "  Ann  ", picture: pic(100) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.displayName).toBe("Ann");
  });
  it("rejects an empty display name", () => {
    const r = validateOnboarding({ displayName: "   " });
    expect(r).toEqual({ ok: false, errors: { displayName: DISPLAY_NAME_MESSAGE } });
  });
  it("reports only the picture error when the name is valid, keeping the name usable", () => {
    const input = { displayName: "Ann", picture: pic(PICTURE_MAX_BYTES + 1) };
    const r = validateOnboarding(input);
    expect(r).toEqual({ ok: false, errors: { picture: PICTURE_MESSAGE } });
    // The caller still holds the typed name and can resubmit without a picture.
    expect(input.displayName).toBe("Ann");
    const retry = validateOnboarding({ displayName: input.displayName, picture: null });
    expect(retry.ok).toBe(true);
  });
});

describe("completeOnboarding (Req 1.5, 1.7, 1.8)", () => {
  it("writes identity and first PIN on valid input", async () => {
    const { deps, writes } = setup();
    const r = await completeOnboarding(deps, { displayName: " Ann ", picture: pic(PICTURE_MAX_BYTES) });
    expect(r.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.identity.displayName).toBe("Ann");
    expect(writes[0]!.pin.label).toBe("Main");
  });
  it("writes no Identity for an empty name", async () => {
    const { deps, writes } = setup();
    const r = await completeOnboarding(deps, { displayName: "" });
    expect(r).toMatchObject({ ok: false, kind: "validation" });
    expect(writes).toHaveLength(0);
  });
  it("writes no Identity for an oversize or non-image picture", async () => {
    const { deps, writes } = setup();
    const big = await completeOnboarding(deps, { displayName: "Ann", picture: pic(PICTURE_MAX_BYTES + 1) });
    const bad = await completeOnboarding(deps, { displayName: "Ann", picture: pic(5, "text/plain") });
    expect(big).toMatchObject({ ok: false, kind: "validation", errors: { picture: PICTURE_MESSAGE } });
    expect(bad).toMatchObject({ ok: false, kind: "validation" });
    expect(writes).toHaveLength(0);
  });
  it("writes nothing when registration fails", async () => {
    const { deps, writes } = setup(false);
    const r = await completeOnboarding(deps, { displayName: "Ann" });
    expect(r).toMatchObject({ ok: false, kind: "failed" });
    expect(writes).toHaveLength(0);
  });
});

describe("onboarding route form (Req 1.1, 1.5, 1.8)", () => {
  const src = readFileSync(resolve(__dirname, "../../routes/onboarding.tsx"), "utf8");
  it("has no phone or email inputs", () => {
    expect(src).not.toMatch(/type="(tel|email)"/);
    expect(src).not.toMatch(/name="(phone|tel|email)"/i);
    expect(src).not.toMatch(/autoComplete="(tel|email)"/);
  });
  it("offers only a display name and an image-only picture input", () => {
    const inputs = [...src.matchAll(/<input[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toContain('name="displayName"');
    expect(inputs[1]).toContain('type="file"');
    expect(inputs[1]).toContain('accept="image/*"');
  });
  it("keeps the display name state when a picture is rejected", () => {
    const handler = src.slice(src.indexOf("function onPictureChange"), src.indexOf("async function onSubmit"));
    expect(handler).toContain("setPicture(null)");
    expect(handler).not.toContain("setDisplayName");
  });
});
