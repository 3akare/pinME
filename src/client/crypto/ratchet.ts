import sodium from "libsodium-wrappers";

/**
 * Forward secrecy: X3DH session setup and the Double Ratchet (Signal's design), on libsodium.
 *
 * - DH: X25519 (`crypto_scalarmult`). Identity keys are each PIN's existing X25519 box keys.
 * - KDF: keyed BLAKE2b with domain separation (root chain: 64 bytes split into root and chain key;
 *   chain step: message key with 0x01, next chain key with 0x02).
 * - AEAD: XChaCha20-Poly1305; its 24-byte nonce is the envelope's nonce field, and the associated
 *   data binds both identity keys and the whole header.
 *
 * Everything here is pure apart from randomness: functions return a new state and never mutate
 * the one passed in, so a caller saves state only after a message has authenticated.
 */

export const MAGIC = new Uint8Array([0x50, 0x4d, 0x52, 0x31]); // "PMR1"
/** Message keys kept for messages that have not arrived yet. */
export const MAX_SKIP = 1000;
const NO_OPK = 0xffffffff;

export interface DhPair {
  pub: Uint8Array;
  priv: Uint8Array;
}

export interface SessionState {
  /** Our current ratchet key pair. */
  dhs: DhPair;
  /** Their current ratchet public key (absent until they have sent, for a responder). */
  dhr?: Uint8Array;
  rk: Uint8Array;
  cks?: Uint8Array;
  ckr?: Uint8Array;
  ns: number;
  nr: number;
  pn: number;
  /** Skipped message keys: `${base64(dh)}:${n}` -> key. */
  skipped: Record<string, Uint8Array>;
  /**
   * Set while we are the initiator and have not heard back: every message repeats the X3DH
   * header so the responder can set up from whichever arrives first.
   */
  init?: { ek: Uint8Array; spkId: number; opkId: number | null };
  /** The initiator's ephemeral key this session was answered from (responder side), to spot repeats. */
  answeredEk?: Uint8Array;
}

export interface Header {
  initial?: { ek: Uint8Array; spkId: number; opkId: number | null };
  dh: Uint8Array;
  pn: number;
  n: number;
}

export interface Bundle {
  spk: { id: number; pub: Uint8Array; sig: Uint8Array };
  opk?: { id: number; pub: Uint8Array };
}

const enc = (s: string) => sodium.from_string(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
};
const readU32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 4).getUint32(0);
const b64 = (b: Uint8Array) => sodium.to_base64(b, sodium.base64_variants.ORIGINAL);
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && sodium.memcmp(a, b);

export function generateDh(): DhPair {
  const kp = sodium.crypto_box_keypair();
  return { pub: kp.publicKey, priv: kp.privateKey };
}

const dh = (priv: Uint8Array, pub: Uint8Array) => sodium.crypto_scalarmult(priv, pub);

function kdfRk(rk: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
  const out = sodium.crypto_generichash(64, cat(enc("pinme/rk"), dhOut), rk);
  return [out.slice(0, 32), out.slice(32)];
}

function kdfCk(ck: Uint8Array): [Uint8Array, Uint8Array] {
  const mk = sodium.crypto_generichash(32, new Uint8Array([1]), ck);
  const next = sodium.crypto_generichash(32, new Uint8Array([2]), ck);
  return [next, mk];
}

/** Ed25519 signature over a signed prekey's public key. */
export function signPrekey(pub: Uint8Array, signSk: Uint8Array): Uint8Array {
  return sodium.crypto_sign_detached(cat(enc("pinme/spk"), pub), signSk);
}

export function verifyPrekey(pub: Uint8Array, sig: Uint8Array, signPk: Uint8Array): boolean {
  try {
    return sodium.crypto_sign_verify_detached(sig, cat(enc("pinme/spk"), pub), signPk);
  } catch {
    return false;
  }
}

function x3dhSecret(parts: Uint8Array[]): Uint8Array {
  return sodium.crypto_generichash(32, cat(enc("pinme/x3dh"), ...parts), null);
}

/**
 * Initiator side of X3DH. Throws when the signed prekey's signature does not verify against the
 * peer's Ed25519 key from the Directory.
 */
export function initiate(ourIk: DhPair, theirIk: Uint8Array, theirSignPk: Uint8Array, bundle: Bundle): SessionState {
  if (!verifyPrekey(bundle.spk.pub, bundle.spk.sig, theirSignPk)) throw new Error("bad_prekey_signature");
  const ek = generateDh();
  const parts = [dh(ourIk.priv, bundle.spk.pub), dh(ek.priv, theirIk), dh(ek.priv, bundle.spk.pub)];
  if (bundle.opk) parts.push(dh(ek.priv, bundle.opk.pub));
  const sk = x3dhSecret(parts);
  const dhs = generateDh();
  const [rk, cks] = kdfRk(sk, dh(dhs.priv, bundle.spk.pub));
  return {
    dhs,
    dhr: bundle.spk.pub,
    rk,
    cks,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    init: { ek: ek.pub, spkId: bundle.spk.id, opkId: bundle.opk?.id ?? null },
  };
}

/** Responder side of X3DH, from the first message's header and our matching prekeys. */
export function respond(ourIk: DhPair, theirIk: Uint8Array, spk: DhPair, opk: DhPair | null, ek: Uint8Array): SessionState {
  const parts = [dh(spk.priv, theirIk), dh(ourIk.priv, ek), dh(spk.priv, ek)];
  if (opk) parts.push(dh(opk.priv, ek));
  return { dhs: spk, rk: x3dhSecret(parts), ns: 0, nr: 0, pn: 0, skipped: {}, answeredEk: ek };
}

export function encodeHeader(h: Header): Uint8Array {
  const flag = new Uint8Array([h.initial ? 1 : 0]);
  const init = h.initial ? cat(h.initial.ek, u32(h.initial.spkId), u32(h.initial.opkId ?? NO_OPK)) : new Uint8Array(0);
  return cat(MAGIC, flag, init, h.dh, u32(h.pn), u32(h.n));
}

/** Splits a ratchet ciphertext into header bytes, header and AEAD body; null if it is not one. */
export function parseMessage(bytes: Uint8Array): { headerBytes: Uint8Array; header: Header; body: Uint8Array } | null {
  if (bytes.length < MAGIC.length + 1 + 32 + 8 + 16 || !eq(bytes.slice(0, 4), MAGIC)) return null;
  const flag = bytes[4];
  let o = 5;
  let initial: Header["initial"];
  if (flag === 1) {
    if (bytes.length < o + 40 + 32 + 8 + 16) return null;
    const opk = readU32(bytes, o + 36);
    initial = { ek: bytes.slice(o, o + 32), spkId: readU32(bytes, o + 32), opkId: opk === NO_OPK ? null : opk };
    o += 40;
  } else if (flag !== 0) {
    return null;
  }
  const header: Header = { initial, dh: bytes.slice(o, o + 32), pn: readU32(bytes, o + 32), n: readU32(bytes, o + 36) };
  o += 40;
  return { headerBytes: bytes.slice(0, o), header, body: bytes.slice(o) };
}

const ad = (senderIk: Uint8Array, receiverIk: Uint8Array, headerBytes: Uint8Array) => cat(senderIk, receiverIk, headerBytes);

/** Encrypts one message; returns the bytes for the envelope's ciphertext field and the next state. */
export function encrypt(
  s: SessionState,
  plain: Uint8Array,
  nonce: Uint8Array,
  ourIkPub: Uint8Array,
  theirIk: Uint8Array,
): { bytes: Uint8Array; state: SessionState } {
  if (!s.cks) throw new Error("no_sending_chain");
  const [cks, mk] = kdfCk(s.cks);
  const header: Header = { dh: s.dhs.pub, pn: s.pn, n: s.ns, ...(s.init ? { initial: s.init } : {}) };
  const headerBytes = encodeHeader(header);
  const body = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, ad(ourIkPub, theirIk, headerBytes), null, nonce, mk);
  return { bytes: cat(headerBytes, body), state: { ...s, cks, ns: s.ns + 1 } };
}

function skipTo(s: SessionState, until: number): SessionState | null {
  if (!s.ckr) return s;
  if (until - s.nr > MAX_SKIP) return null;
  let ckr = s.ckr;
  const skipped = { ...s.skipped };
  let nr = s.nr;
  while (nr < until) {
    const [next, mk] = kdfCk(ckr);
    skipped[`${b64(s.dhr!)}:${nr}`] = mk;
    ckr = next;
    nr++;
  }
  // Bound memory: drop the oldest keys beyond the cap.
  const keys = Object.keys(skipped);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SKIP))) delete skipped[k];
  return { ...s, ckr, nr, skipped };
}

function dhRatchet(s: SessionState, theirDh: Uint8Array): SessionState {
  const [rk1, ckr] = kdfRk(s.rk, dh(s.dhs.priv, theirDh));
  const dhs = generateDh();
  const [rk2, cks] = kdfRk(rk1, dh(dhs.priv, theirDh));
  return { ...s, pn: s.ns, ns: 0, nr: 0, dhr: theirDh, rk: rk2, ckr, cks, dhs };
}

/**
 * Decrypts one message. Returns null (and no new state) when it does not authenticate, so a
 * forged, replayed or garbled message changes nothing.
 */
export function decrypt(
  s: SessionState,
  parsed: { headerBytes: Uint8Array; header: Header; body: Uint8Array },
  nonce: Uint8Array,
  ourIkPub: Uint8Array,
  theirIk: Uint8Array,
): { plain: Uint8Array; state: SessionState } | null {
  const { header, headerBytes, body } = parsed;
  const aead = (mk: Uint8Array) => {
    try {
      return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, body, ad(theirIk, ourIkPub, headerBytes), nonce, mk);
    } catch {
      return null;
    }
  };
  const skipKey = `${b64(header.dh)}:${header.n}`;
  const stored = s.skipped[skipKey];
  if (stored) {
    const plain = aead(stored);
    if (!plain) return null;
    const skipped = { ...s.skipped };
    delete skipped[skipKey];
    return { plain, state: { ...s, skipped } };
  }
  let next: SessionState | null = s;
  if (!s.dhr || !eq(header.dh, s.dhr)) {
    next = skipTo(s, header.pn);
    if (!next) return null;
    next = dhRatchet(next, header.dh);
  }
  next = skipTo(next, header.n);
  if (!next || !next.ckr) return null;
  const [ckr, mk] = kdfCk(next.ckr);
  const plain = aead(mk);
  if (!plain) return null;
  // Hearing back means they have our session: stop repeating the X3DH header.
  const { init: _done, ...rest } = next;
  return { plain, state: { ...rest, ckr, nr: next.nr + 1 } };
}
