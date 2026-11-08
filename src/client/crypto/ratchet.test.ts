import fc from "fast-check";
import sodium from "libsodium-wrappers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decrypt,
  encrypt,
  generateDh,
  initiate,
  parseMessage,
  respond,
  signPrekey,
  type DhPair,
  type SessionState,
} from "./ratchet";

beforeAll(async () => {
  await sodium.ready;
});

const txt = (s: string) => sodium.from_string(s);
const str = (b: Uint8Array) => sodium.to_string(b);
const nonce = () => sodium.randombytes_buf(24);

interface Party {
  ik: DhPair;
  sign: { publicKey: Uint8Array; privateKey: Uint8Array };
  spk: DhPair;
  opk: DhPair;
}
function party(): Party {
  return { ik: generateDh(), sign: sodium.crypto_sign_keypair(), spk: generateDh(), opk: generateDh() };
}
const bundleOf = (p: Party, withOpk = true) => ({
  spk: { id: 7, pub: p.spk.pub, sig: signPrekey(p.spk.pub, p.sign.privateKey) },
  ...(withOpk ? { opk: { id: 9, pub: p.opk.pub } } : {}),
});

/** A sealed message as it would travel: envelope nonce plus ciphertext bytes. */
type Wire = { nonce: Uint8Array; bytes: Uint8Array };

function send(s: SessionState, from: Party, to: Party, text: string): { wire: Wire; state: SessionState } {
  const n = nonce();
  const r = encrypt(s, txt(text), n, from.ik.pub, to.ik.pub);
  return { wire: { nonce: n, bytes: r.bytes }, state: r.state };
}

/** Receiver side: sets up from the X3DH header when it has no session yet. */
function receive(s: SessionState | null, me: Party, them: Party, w: Wire): { text: string; state: SessionState } | null {
  const parsed = parseMessage(w.bytes);
  if (!parsed) return null;
  let state = s;
  if (!state) {
    const init = parsed.header.initial!;
    state = respond(me.ik, them.ik.pub, me.spk, init.opkId === null ? null : me.opk, init.ek);
  }
  const r = decrypt(state, parsed, w.nonce, me.ik.pub, them.ik.pub);
  return r ? { text: str(r.plain), state: r.state } : null;
}

describe("X3DH + double ratchet", () => {
  it("carries a conversation both ways, with and without a one-time prekey", () => {
    for (const withOpk of [true, false]) {
      const a = party();
      const b = party();
      let sa = initiate(a.ik, b.ik.pub, b.sign.publicKey, bundleOf(b, withOpk));
      let sb: SessionState | null = null;
      for (let i = 0; i < 5; i++) {
        const m = send(sa, a, b, `a${i}`);
        sa = m.state;
        const got = receive(sb, b, a, m.wire)!;
        expect(got.text).toBe(`a${i}`);
        sb = got.state;
        const r = send(sb, b, a, `b${i}`);
        sb = r.state;
        const back = receive(sa, a, b, r.wire)!;
        expect(back.text).toBe(`b${i}`);
        sa = back.state;
      }
      expect(sa.init).toBeUndefined();
    }
  });

  it("rejects a signed prekey that does not verify", () => {
    const a = party();
    const b = party();
    const forged = { spk: { id: 1, pub: generateDh().pub, sig: signPrekey(b.spk.pub, b.sign.privateKey) } };
    expect(() => initiate(a.ik, b.ik.pub, b.sign.publicKey, forged)).toThrow("bad_prekey_signature");
  });

  it("decrypts out of order and across lost messages, and never twice", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 12 }), fc.array(fc.boolean(), { maxLength: 12 }), (order, drops) => {
        const a = party();
        const b = party();
        let sa = initiate(a.ik, b.ik.pub, b.sign.publicKey, bundleOf(b));
        const wires: Wire[] = [];
        for (let i = 0; i < order.length; i++) {
          const m = send(sa, a, b, `m${i}`);
          sa = m.state;
          wires.push(m.wire);
        }
        // Deliver a shuffled subset.
        const idx = wires.map((_, i) => i).sort((x, y) => (order[x]! % 7) - (order[y]! % 7) || x - y);
        let sb: SessionState | null = null;
        for (const i of idx) {
          if (drops[i]) continue;
          const got = receive(sb, b, a, wires[i]!);
          expect(got?.text).toBe(`m${i}`);
          sb = got!.state;
          // A replay of the same message is refused and changes nothing.
          expect(receive(sb, b, a, wires[i]!)).toBeNull();
        }
      }),
      { numRuns: 60 },
    );
  });

  it("refuses tampered headers, bodies and nonces", () => {
    const a = party();
    const b = party();
    const sa = initiate(a.ik, b.ik.pub, b.sign.publicKey, bundleOf(b));
    const m = send(sa, a, b, "secret");
    const flip = (bytes: Uint8Array, at: number) => {
      const c = bytes.slice();
      c[at] = c[at]! ^ 1;
      return c;
    };
    expect(receive(null, b, a, { ...m.wire, bytes: flip(m.wire.bytes, m.wire.bytes.length - 1) })).toBeNull();
    expect(receive(null, b, a, { ...m.wire, bytes: flip(m.wire.bytes, 60) })).toBeNull();
    expect(receive(null, b, a, { ...m.wire, nonce: flip(m.wire.nonce, 0) })).toBeNull();
    expect(receive(null, b, a, m.wire)?.text).toBe("secret");
  });

  it("forward secrecy: today's state cannot open yesterday's messages", () => {
    const a = party();
    const b = party();
    let sa = initiate(a.ik, b.ik.pub, b.sign.publicKey, bundleOf(b));
    const first = send(sa, a, b, "old secret");
    sa = first.state;
    let sb = receive(null, b, a, first.wire)!.state;
    // A few round trips move both ratchets forward.
    for (let i = 0; i < 3; i++) {
      const r = send(sb, b, a, `r${i}`);
      sb = r.state;
      sa = receive(sa, a, b, r.wire)!.state;
      const m = send(sa, a, b, `m${i}`);
      sa = m.state;
      sb = receive(sb, b, a, m.wire)!.state;
    }
    // An attacker who steals B's whole current state still cannot read the first message.
    const parsed = parseMessage(first.wire.bytes)!;
    expect(decrypt(sb, parsed, first.wire.nonce, b.ik.pub, a.ik.pub)).toBeNull();
  });

  it("simultaneous starts converge once each side answers with the session that worked", () => {
    const a = party();
    const b = party();
    // Each side initiates before hearing from the other.
    let aSessions: SessionState[] = [initiate(a.ik, b.ik.pub, b.sign.publicKey, bundleOf(b))];
    let bSessions: SessionState[] = [initiate(b.ik, a.ik.pub, a.sign.publicKey, bundleOf(a))];
    const tryAll = (sessions: SessionState[], me: Party, them: Party, w: Wire) => {
      for (let i = 0; i < sessions.length; i++) {
        const r = receive(sessions[i]!, me, them, w);
        if (r) return { text: r.text, sessions: [r.state, ...sessions.filter((_, j) => j !== i)] };
      }
      const fresh = receive(null, me, them, w);
      return fresh ? { text: fresh.text, sessions: [fresh.state, ...sessions] } : null;
    };
    const ma = send(aSessions[0]!, a, b, "hi from a");
    aSessions = [ma.state];
    const mb = send(bSessions[0]!, b, a, "hi from b");
    bSessions = [mb.state];
    const atB = tryAll(bSessions, b, a, ma.wire)!;
    expect(atB.text).toBe("hi from a");
    bSessions = atB.sessions;
    const atA = tryAll(aSessions, a, b, mb.wire)!;
    expect(atA.text).toBe("hi from b");
    aSessions = atA.sessions;
    // Each now writes with its newest (front) session; the other side finds the match.
    for (let i = 0; i < 3; i++) {
      const x = send(aSessions[0]!, a, b, `a${i}`);
      aSessions = [x.state, ...aSessions.slice(1)];
      const gotB = tryAll(bSessions, b, a, x.wire)!;
      expect(gotB.text).toBe(`a${i}`);
      bSessions = gotB.sessions;
      const y = send(bSessions[0]!, b, a, `b${i}`);
      bSessions = [y.state, ...bSessions.slice(1)];
      const gotA = tryAll(aSessions, a, b, y.wire)!;
      expect(gotA.text).toBe(`b${i}`);
      aSessions = gotA.sessions;
    }
  });
});
