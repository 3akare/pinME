import fc from "fast-check";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../../shared/base64";
import { decrypt, encrypt, generatePinKeys, ready } from "../crypto";
import type { ContactRecord, MessageRecord, PinRecord } from "../storage";
import { receiveMessage } from "./receive";

const A = "AAAAAAAA";
const B = "BBBBBBBB";
const MESSAGE_ID = "123e4567-e89b-42d3-a456-426614174000";

let alice: ReturnType<typeof generatePinKeys>;
let bob: ReturnType<typeof generatePinKeys>;
let mallory: ReturnType<typeof generatePinKeys>;

beforeAll(async () => {
  await ready();
  alice = generatePinKeys();
  bob = generatePinKeys();
  mallory = generatePinKeys();
});

/** In-memory repos for receiver `B`, who knows contact `A` by `contactPk` and holds `ownSk`. */
function receiverRepos(ownSk: Uint8Array, contactPk: Uint8Array) {
  const msgs = new Map<string, MessageRecord>();
  const put = vi.fn(async (m: MessageRecord) => void msgs.set(m.messageId, m));
  const addMessage = vi.fn();
  return {
    msgs,
    put,
    addMessage,
    deps: {
      repos: {
        pinRepo: { get: async () => ({ pin: B, boxSk: ownSk }) as PinRecord },
        contactRepo: { get: async () => ({ boxPk: contactPk, unavailable: false }) as ContactRecord },
        messageRepo: { get: async (_o: string, _c: string, id: string) => msgs.get(id), put },
      } as never,
      store: { addMessage },
      decrypt,
    },
  };
}

const plaintext = fc.string({ minLength: 1, maxLength: 512 });

describe("Property 18: Failed decryption leaves no trace", () => {
  /** **Validates: Requirements 7.8** */
  it("an altered nonce or ciphertext byte yields null and no store/chat writes", async () => {
    await fc.assert(
      fc.asyncProperty(
        plaintext,
        fc.boolean(),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        async (m, alterNonce, idx, xor) => {
          const env = encrypt(m, bob.box.publicKey, alice.box.privateKey);
          const target = alterNonce ? env.nonce : env.ciphertext;
          target[idx % target.length]! ^= xor; // guaranteed to change at least one byte

          expect(decrypt(env, alice.box.publicKey, bob.box.privateKey)).toBeNull();

          const r = receiverRepos(bob.box.privateKey, alice.box.publicKey);
          const got = await receiveMessage(r.deps, B, {
            from: A,
            envelope: {
              to: B,
              messageId: MESSAGE_ID,
              nonce: bytesToBase64(env.nonce),
              ciphertext: bytesToBase64(env.ciphertext),
            },
          });
          expect(got).toBeNull();
          expect(r.put).not.toHaveBeenCalled();
          expect(r.msgs.size).toBe(0);
          expect(r.addMessage).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 7.8** */
  it("decrypting with a wrong key yields null and no store/chat writes", async () => {
    await fc.assert(
      fc.asyncProperty(plaintext, fc.boolean(), async (m, wrongOwnSk) => {
        const env = encrypt(m, bob.box.publicKey, alice.box.privateKey);
        // Either the receiver's secret key is wrong, or the sender's public key is wrong.
        const ownSk = wrongOwnSk ? mallory.box.privateKey : bob.box.privateKey;
        const contactPk = wrongOwnSk ? alice.box.publicKey : mallory.box.publicKey;

        expect(decrypt(env, contactPk, ownSk)).toBeNull();

        const r = receiverRepos(ownSk, contactPk);
        const got = await receiveMessage(r.deps, B, {
          from: A,
          envelope: {
            to: B,
            messageId: MESSAGE_ID,
            nonce: bytesToBase64(env.nonce),
            ciphertext: bytesToBase64(env.ciphertext),
          },
        });
        expect(got).toBeNull();
        expect(r.put).not.toHaveBeenCalled();
        expect(r.msgs.size).toBe(0);
        expect(r.addMessage).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it("control: the untouched envelope with correct keys is saved", async () => {
    const env = encrypt("ok", bob.box.publicKey, alice.box.privateKey);
    const r = receiverRepos(bob.box.privateKey, alice.box.publicKey);
    const got = await receiveMessage(r.deps, B, {
      from: A,
      envelope: { to: B, messageId: MESSAGE_ID, nonce: bytesToBase64(env.nonce), ciphertext: bytesToBase64(env.ciphertext) },
    });
    expect(got?.text).toBe("ok");
    expect(r.addMessage).toHaveBeenCalledOnce();
  });
});
