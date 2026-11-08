import { beforeAll, describe, expect, it } from "vitest";
import { generatePinKeys, randomBytes, ready } from "./index";

describe("Crypto_Module (minimal)", () => {
  beforeAll(async () => {
    await ready();
  });

  it("generates X25519 and Ed25519 pairs of the right sizes", () => {
    const k = generatePinKeys();
    expect(k.box.publicKey).toHaveLength(32);
    expect(k.box.privateKey).toHaveLength(32);
    expect(k.sign.publicKey).toHaveLength(32);
    expect(k.sign.privateKey).toHaveLength(64);
  });

  it("generates unique keys per call", () => {
    const a = generatePinKeys();
    const b = generatePinKeys();
    expect(a.box.publicKey).not.toEqual(b.box.publicKey);
    expect(a.sign.publicKey).not.toEqual(b.sign.publicKey);
  });

  it("returns n random bytes", () => {
    expect(randomBytes(24)).toHaveLength(24);
    expect(randomBytes(16)).not.toEqual(randomBytes(16));
  });
});
