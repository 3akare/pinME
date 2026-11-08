---
inclusion: fileMatch
fileMatchPattern: "src/client/crypto/**"
---

# Crypto rules

- `libsodium-wrappers` is imported only under `src/client/crypto`. ESLint enforces this. Await `ready()` before any call.
- Messages go through the forward-secret channel (`src/client/secure/channel.ts`): X3DH + Double Ratchet from `ratchet.ts`, XChaCha20-Poly1305 with a fresh random 24-byte nonce per message. Ratchet functions are pure; session state is saved only after a message encrypts or authenticates.
- Legacy fallback: `crypto_box_easy` / `crypto_box_open_easy` with a fresh random nonce, only for peers without published prekeys and for old messages.
- Every decrypt catches all errors and returns `null`. A failed decrypt writes nothing to storage or the conversation.
- Signed prekeys are signed with the PIN's Ed25519 key and verified against the Directory's key before use; one-time prekeys are deleted after one use.
- Sign challenges and Signed_Requests with Ed25519 (`crypto_sign_detached`). The server verifies with WebCrypto Ed25519 using raw 32-byte keys.
- Each PIN gets its own X25519 and Ed25519 key pairs. Never share keys between PINs.
- Signed_Request bytes come from `canonicalize` in `src/shared/canonical.ts` (prefix `pinme/v1`, length-prefixed fields, fixed order). Never sign ad-hoc JSON.
- Never log keys, plaintext, nonces or ciphertext. No `console.*` of crypto values.
- Keep functions pure and side-effect free apart from randomness so property tests can cover them.
