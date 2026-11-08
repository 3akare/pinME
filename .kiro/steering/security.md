---
inclusion: always
---

# Security rules

- Private keys (X25519 and Ed25519) never leave the Local_Store (IndexedDB, `src/client/storage`). No network payload type, schema, server function or log line may carry a private key field. The one exception is the user's own backup file: sealed in the browser with their passphrase (`src/client/crypto/backup.ts`) and saved locally, never sent to the server.
- The server never logs plaintext, private keys or ciphertext.
- Server and Durable Object code (`src/server`, `src/durable`, `src/db`) logs only through `safeLog` from `src/shared/safeLog.ts`. It accepts event, type, field and code, never free-form payloads. No `console.log` of request bodies, envelopes or errors that embed content.
- Fail closed. On any uncertainty (Directory unreachable, unparsable frame, unknown socket state, failed signature) drop the item and return a coded error. Never default to allow.
- Reject request bodies containing keys matching `/priv|secret/i` with `private_key_not_accepted` before any persistence or logging.
- No phone number or email fields anywhere: schemas, tables, forms, logs.
- No data may link PINs owned by the same user. No column, log or payload may reference two PINs of one owner. Each PIN has its own key pairs.
- The Directory stores only display name, Personal_Message, Presence_Status, public keys, invites, contact pairs and burned PIN records. Messages are never stored in the Directory.
- Secrets live in wrangler secrets or `.dev.vars`; `.dev.vars` stays in `.gitignore`.
