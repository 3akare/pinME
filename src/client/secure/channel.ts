import * as ratchet from "../crypto/ratchet";
import type { Bundle, SessionState } from "../crypto/ratchet";
import type { Repositories } from "../storage";

/** Sessions kept per peer; more than one only while two simultaneous starts converge. */
const MAX_SESSIONS = 3;

export type Sealed = { nonce: Uint8Array; ciphertext: Uint8Array };

export interface ChannelDeps {
  repos: Pick<Repositories, "pinRepo" | "contactRepo" | "groupRepo" | "sessionRepo" | "prekeyRepo">;
  /** A prekey bundle for the peer (signed request); null when they have none or it is unreachable. */
  fetchBundle: (ownPin: string, peerPin: string) => Promise<Bundle | null>;
  /** One of our one-time prekeys was used: top them up soon. */
  onPrekeyUsed?: (ownPin: string) => void;
  randomBytes: (n: number) => Uint8Array;
  /** Pre-forward-secrecy encryption, for peers that have not published prekeys. */
  legacyEncrypt: (plain: string, recipientBoxPk: Uint8Array, senderBoxSk: Uint8Array) => Sealed;
  legacyDecrypt: (env: Sealed, senderBoxPk: Uint8Array, recipientBoxSk: Uint8Array) => string | null;
  now?: () => number;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Forward-secret messaging between two PINs. Every seal and open for one pair runs in order, and
 * a session is written back only after its message encrypted or authenticated.
 */
export function createSecureChannel(deps: ChannelDeps) {
  const now = deps.now ?? Date.now;
  const locks = new Map<string, Promise<unknown>>();

  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    locks.set(
      key,
      run.catch(() => undefined),
    );
    return run;
  }

  async function load(ownPin: string, peerPin: string): Promise<SessionState[]> {
    return ((await deps.repos.sessionRepo.get(ownPin, peerPin))?.sessions ?? []) as SessionState[];
  }
  async function save(ownPin: string, peerPin: string, sessions: SessionState[]): Promise<void> {
    await deps.repos.sessionRepo.put({ ownPin, peerPin, sessions: sessions.slice(0, MAX_SESSIONS), updatedAt: now() });
  }

  /** The peer's Ed25519 key from what we already hold (Contact or group-mate record). */
  async function signKeyOf(ownPin: string, peerPin: string): Promise<Uint8Array | null> {
    const c = await deps.repos.contactRepo.get(ownPin, peerPin);
    if (c) return c.signPk;
    for (const g of await deps.repos.groupRepo.listForPin(ownPin)) {
      const m = g.members.find((x) => x.pin === peerPin);
      if (m?.signPk) return m.signPk;
    }
    return null;
  }

  /** Starts a session from the peer's prekeys unless one can already send. */
  async function establish(ownPin: string, peerPin: string, peerIk: Uint8Array, ik: { pub: Uint8Array; priv: Uint8Array }) {
    const sessions = await load(ownPin, peerPin);
    if (sessions[0]?.cks) return sessions;
    const [bundle, signPk] = await Promise.all([deps.fetchBundle(ownPin, peerPin).catch(() => null), signKeyOf(ownPin, peerPin)]);
    if (!bundle || !signPk) return null;
    try {
      const fresh = ratchet.initiate(ik, peerIk, signPk, bundle);
      const next = [fresh, ...sessions];
      await save(ownPin, peerPin, next);
      return next;
    } catch {
      return null; // a prekey that does not verify is never used
    }
  }

  return {
    /** Sets up the session ahead of the first message (e.g. when a chat opens), so sending is instant. */
    warm(ownPin: string, peerPin: string, peerIk: Uint8Array): Promise<void> {
      return serial(`${ownPin}:${peerPin}`, async () => {
        const pin = await deps.repos.pinRepo.get(ownPin);
        if (pin) await establish(ownPin, peerPin, peerIk, { pub: pin.boxPk, priv: pin.boxSk });
      });
    },

    /** Encrypts for the peer: with their ratchet session, a new one from their prekeys, or (last resort) the legacy box. */
    seal(ownPin: string, peerPin: string, peerIk: Uint8Array, text: string): Promise<Sealed> {
      return serial(`${ownPin}:${peerPin}`, async () => {
        const pin = await deps.repos.pinRepo.get(ownPin);
        if (!pin) throw new Error("unknown_pin");
        const ik = { pub: pin.boxPk, priv: pin.boxSk };
        const sessions = await establish(ownPin, peerPin, peerIk, ik);
        if (!sessions) return deps.legacyEncrypt(text, peerIk, pin.boxSk);
        const nonce = deps.randomBytes(24);
        const out = ratchet.encrypt(sessions[0]!, utf8.encode(text), nonce, ik.pub, peerIk);
        await save(ownPin, peerPin, [out.state, ...sessions.slice(1)]);
        return { nonce, ciphertext: out.bytes };
      });
    },

    /** Decrypts from the peer; null (and nothing saved) when it does not authenticate. */
    open(ownPin: string, peerPin: string, peerIk: Uint8Array, env: Sealed): Promise<string | null> {
      return serial(`${ownPin}:${peerPin}`, async () => {
        const pin = await deps.repos.pinRepo.get(ownPin);
        if (!pin) return null;
        const parsed = ratchet.parseMessage(env.ciphertext);
        if (!parsed) return deps.legacyDecrypt(env, peerIk, pin.boxSk);
        const sessions = await load(ownPin, peerPin);
        const toText = (b: Uint8Array) => {
          try {
            return fromUtf8.decode(b);
          } catch {
            return null;
          }
        };
        for (let i = 0; i < sessions.length; i++) {
          const r = ratchet.decrypt(sessions[i]!, parsed, env.nonce, pin.boxPk, peerIk);
          if (!r) continue;
          const text = toText(r.plain);
          if (text === null) return null;
          // The session that worked moves to the front, so both sides settle on one.
          await save(ownPin, peerPin, [r.state, ...sessions.filter((_, j) => j !== i)]);
          return text;
        }
        const init = parsed.header.initial;
        if (!init) return deps.legacyDecrypt(env, peerIk, pin.boxSk);
        // A first message: answer it from our prekeys.
        const spk = await deps.repos.prekeyRepo.get(ownPin, init.spkId);
        const opk = init.opkId === null ? null : await deps.repos.prekeyRepo.get(ownPin, init.opkId);
        if (!spk || spk.kind !== "spk" || (init.opkId !== null && (!opk || opk.kind !== "opk"))) return null;
        const fresh = ratchet.respond(
          { pub: pin.boxPk, priv: pin.boxSk },
          peerIk,
          { pub: spk.pub, priv: spk.priv },
          opk ? { pub: opk.pub, priv: opk.priv } : null,
          init.ek,
        );
        const r = ratchet.decrypt(fresh, parsed, env.nonce, pin.boxPk, peerIk);
        if (!r) return null;
        const text = toText(r.plain);
        if (text === null) return null;
        await save(ownPin, peerPin, [r.state, ...sessions]);
        if (opk) {
          await deps.repos.prekeyRepo.delete(ownPin, opk.id); // one-time: gone for good
          deps.onPrekeyUsed?.(ownPin);
        }
        return text;
      });
    },
  };
}

export type SecureChannel = ReturnType<typeof createSecureChannel>;
