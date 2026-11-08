import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { base64ToBytes } from "../../shared/base64";
import { decrypt, encrypt, generatePinKeys, randomBytes, ready } from "../crypto";
import { MAGIC, type Bundle } from "../crypto/ratchet";
import { openLocalStore, type LocalStore, type PinRecord } from "../storage";
import { createSecureChannel, type SecureChannel } from "./channel";
import { ensurePrekeys, OPK_BATCH } from "./prekeys";

let n = 0;
let seq = 1;

interface Person {
  pin: PinRecord;
  store: LocalStore;
  channel: SecureChannel;
  used: ReturnType<typeof vi.fn>;
}

/** A tiny prekey server: what each PIN published, handing out one one-time key per bundle. */
function server() {
  const db = new Map<string, { spk?: Bundle["spk"]; opks: { id: number; pub: Uint8Array }[] }>();
  return {
    db,
    publish: async (pin: PinRecord, p: { spk?: { id: number; pub: string; sig: string }; opks: { id: number; pub: string }[] }) => {
      const e = db.get(pin.pin) ?? { opks: [] };
      if (p.spk) e.spk = { id: p.spk.id, pub: base64ToBytes(p.spk.pub), sig: base64ToBytes(p.spk.sig) };
      e.opks.push(...p.opks.map((o) => ({ id: o.id, pub: base64ToBytes(o.pub) })));
      db.set(pin.pin, e);
      return { ok: true as const, value: { opkCount: e.opks.length } };
    },
    take: async (pin: string): Promise<Bundle | null> => {
      const e = db.get(pin);
      if (!e?.spk) return null;
      const opk = e.opks.shift();
      return opk ? { spk: e.spk, opk } : { spk: e.spk };
    },
  };
}

async function person(code: string, srv: ReturnType<typeof server>, publish = true): Promise<Person> {
  const store = await openLocalStore(`channel-${n++}`);
  const k = generatePinKeys();
  const pin: PinRecord = {
    pin: code,
    label: "Main",
    boxSk: k.box.privateKey,
    boxPk: k.box.publicKey,
    signSk: k.sign.privateKey,
    signPk: k.sign.publicKey,
    status: "active",
    personalMessage: "",
    createdAt: 1,
  };
  await store.pinRepo.put(pin);
  if (publish) await ensurePrekeys({ repos: store, publish: srv.publish, randomId: () => seq++ }, pin);
  const used = vi.fn();
  const channel = createSecureChannel({
    repos: store,
    fetchBundle: (_own, peer) => srv.take(peer),
    onPrekeyUsed: used,
    randomBytes,
    legacyEncrypt: encrypt,
    legacyDecrypt: decrypt,
  });
  return { pin, store, channel, used };
}

/** Each knows the other as a Contact (keys from the Directory). */
async function befriend(a: Person, b: Person) {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    await x.store.contactRepo.put({
      ownPin: x.pin.pin,
      contactPin: y.pin.pin,
      displayName: y.pin.pin,
      boxPk: y.pin.boxPk,
      signPk: y.pin.signPk,
      status: "active",
      personalMessage: "",
      unavailable: false,
    });
  }
}

const isRatchet = (c: Uint8Array) => MAGIC.every((v, i) => c[i] === v);

beforeAll(async () => {
  await ready();
});

describe("secure channel", () => {
  it("sets up from prekeys and talks both ways; each one-time key is used once", async () => {
    const srv = server();
    const a = await person("AAAAAAAA", srv);
    const b = await person("BBBBBBBB", srv);
    await befriend(a, b);
    expect(srv.db.get(b.pin.pin)!.opks).toHaveLength(OPK_BATCH);

    const s1 = await a.channel.seal(a.pin.pin, b.pin.pin, b.pin.boxPk, "hello bob");
    expect(isRatchet(s1.ciphertext)).toBe(true);
    expect(await b.channel.open(b.pin.pin, a.pin.pin, a.pin.boxPk, s1)).toBe("hello bob");
    expect(b.used).toHaveBeenCalledWith(b.pin.pin);
    expect(srv.db.get(b.pin.pin)!.opks).toHaveLength(OPK_BATCH - 1);
    expect((await b.store.prekeyRepo.listForPin(b.pin.pin)).filter((k) => k.kind === "opk")).toHaveLength(OPK_BATCH - 1);

    // A replay is refused (its key is gone, and so is the one-time prekey).
    expect(await b.channel.open(b.pin.pin, a.pin.pin, a.pin.boxPk, s1)).toBeNull();

    for (let i = 0; i < 3; i++) {
      const r = await b.channel.seal(b.pin.pin, a.pin.pin, a.pin.boxPk, `reply ${i}`);
      expect(await a.channel.open(a.pin.pin, b.pin.pin, b.pin.boxPk, r)).toBe(`reply ${i}`);
      const m = await a.channel.seal(a.pin.pin, b.pin.pin, b.pin.boxPk, `more ${i}`);
      expect(await b.channel.open(b.pin.pin, a.pin.pin, a.pin.boxPk, m)).toBe(`more ${i}`);
    }
    // Only one bundle was ever taken: the session carries on without the server.
    expect(srv.db.get(b.pin.pin)!.opks).toHaveLength(OPK_BATCH - 1);
  });

  it("falls back to the legacy box for a peer that has not published prekeys", async () => {
    const srv = server();
    const a = await person("AAAAAAAA", srv);
    const b = await person("BBBBBBBB", srv, false);
    await befriend(a, b);
    const s = await a.channel.seal(a.pin.pin, b.pin.pin, b.pin.boxPk, "old style");
    expect(isRatchet(s.ciphertext)).toBe(false);
    expect(await b.channel.open(b.pin.pin, a.pin.pin, a.pin.boxPk, s)).toBe("old style");
  });

  it("never uses a prekey whose signature fails", async () => {
    const srv = server();
    const a = await person("AAAAAAAA", srv);
    const b = await person("BBBBBBBB", srv);
    await befriend(a, b);
    srv.db.get(b.pin.pin)!.spk!.sig = new Uint8Array(64);
    const s = await a.channel.seal(a.pin.pin, b.pin.pin, b.pin.boxPk, "careful");
    expect(isRatchet(s.ciphertext)).toBe(false);
  });

  it("keeps messages in order when sends race", async () => {
    const srv = server();
    const a = await person("AAAAAAAA", srv);
    const b = await person("BBBBBBBB", srv);
    await befriend(a, b);
    const sealed = await Promise.all([0, 1, 2, 3].map((i) => a.channel.seal(a.pin.pin, b.pin.pin, b.pin.boxPk, `m${i}`)));
    const opened = [];
    for (const s of sealed) opened.push(await b.channel.open(b.pin.pin, a.pin.pin, a.pin.boxPk, s));
    expect(opened).toEqual(["m0", "m1", "m2", "m3"]);
  });
});
