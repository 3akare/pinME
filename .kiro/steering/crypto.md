---
inclusion: fileMatch
fileMatchPattern: "src/client/crypto/**"
---

# Crypto rules

- `libsodium-wrappers` is imported only under `src/client/crypto`. ESLint enforces this. Await `ready()` before any call.
- Encrypt with `crypto_box_easy` using a fresh `randombytes_buf(24)` nonce on every call. Never reuse or derive nonces.
- `decrypt` uses `crypto_box_open_easy`, catches all errors and returns `null`. A failed decrypt writes nothing to storage or the conversation.
- Sign challenges and Signed_Requests with Ed25519 (`crypto_sign_detached`). The server verifies with WebCrypto Ed25519 using raw 32-byte keys.
- Each PIN gets its own X25519 and Ed25519 key pairs. Never share keys between PINs.
- Signed_Request bytes come from `canonicalize` in `src/shared/canonical.ts` (prefix `pinme/v1`, length-prefixed fields, fixed order). Never sign ad-hoc JSON.
- Never log keys, plaintext, nonces or ciphertext. No `console.*` of crypto values.
- Keep functions pure and side-effect free apart from randomness so property tests can cover them.
