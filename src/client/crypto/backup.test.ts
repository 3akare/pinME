import { describe, expect, it } from "vitest";
import { openBackup, parseSealed, sealBackup } from "./backup";

const plain = new TextEncoder().encode("keys and chats");
const FAST = { iterations: 1000 }; // the real 600,000 would slow the suite; the code path is the same

describe("backup sealing", () => {
  it("opens with the right passphrase only", async () => {
    const sealed = await sealBackup(plain, "correct horse battery", FAST);
    expect(new TextDecoder().decode((await openBackup(sealed, "correct horse battery"))!)).toBe("keys and chats");
    expect(await openBackup(sealed, "wrong passphrase!")).toBeNull();
  });

  it("refuses a file whose ciphertext was altered", async () => {
    const sealed = await sealBackup(plain, "correct horse battery", FAST);
    const flipped = sealed.data.startsWith("A") ? `B${sealed.data.slice(1)}` : `A${sealed.data.slice(1)}`;
    expect(await openBackup({ ...sealed, data: flipped }, "correct horse battery")).toBeNull();
  });

  it("uses fresh salt and IV every time and the strong default", async () => {
    const a = await sealBackup(plain, "correct horse battery");
    const b = await sealBackup(plain, "correct horse battery", FAST);
    expect(a.kdf.iterations).toBe(600_000);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
  });

  it("recognises only its own format with sane parameters", async () => {
    const good = await sealBackup(plain, "correct horse battery");
    expect(parseSealed(JSON.parse(JSON.stringify(good)))).not.toBeNull();
    expect(parseSealed({ ...good, format: "other" })).toBeNull();
    expect(parseSealed({ ...good, kdf: { ...good.kdf, iterations: 10 } })).toBeNull();
    expect(parseSealed("nope")).toBeNull();
  });
});
