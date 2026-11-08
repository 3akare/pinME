# Implementation Plan: PinMe Burnable PIN Messenger

## Overview

The design uses TypeScript, so all tasks use TypeScript (strict). The build order follows the requested sequence: scaffold and echo, shared protocol, Neon directory, onboarding, crypto, PinMailbox handshake, invites, encrypted chat, receipts and typing, PING, status and broadcast, PIN manager and burn, barcodes, polish and demo. Steering files and ESLint import restrictions are early sub-tasks of task 1. Checkpoints are sub-tasks placed at the end of tasks 5, 8, 12 and 14 so the 14-step numbering is preserved.

Pure logic lives in small modules (`src/shared`, `src/durable/*` helpers, `src/client/*` helpers) so property tests run against them with injected clocks, storage and Directory fakes. Optional requirements 21-24 are out of scope and have no tasks.

Notes on cross-task wiring:
- The Barcode component (task 13) is wired into the onboarding screen and the PIN detail view in 13.3, which satisfies the Barcode part of Requirement 1.4.
- Task 4 creates a minimal Crypto_Module (key generation, random bytes); task 5 completes it.
- "Ping not delivered" results use the existing `error` protocol type with a dedicated error code, since the protocol set is fixed at eleven types.
- If the scanner library cannot decode headlessly for the round trip test in 13.5, add a test-only QR decoder as a devDependency (pinned) and confirm with the user.

## Tasks

- [x] 1. Scaffold TanStack Start on Cloudflare, echo Durable Object, steering and lint rules
  - [x] 1.1 Scaffold the project
    - Create pnpm project with TanStack Start (React), Tailwind CSS, Zustand, Zod, Vitest, fast-check, ESLint, `wrangler.jsonc` (with `nodejs_compat`), `tsconfig.json` with `"strict": true`
    - Add scripts: dev, build, deploy, test (`vitest --run`), lint, db:generate, db:migrate, cf-typegen
    - Add `.dev.vars` to `.gitignore`, create `.dev.vars.example` listing DATABASE_URL with no value
    - Create the hello-world page at `src/routes/index.tsx` and baseline dark theme with blue accent Tailwind tokens (text/background contrast of at least 4.5:1)
    - Pin exact dependency versions
    - _Requirements: 18.1, 18.2, 18.5, 18.8, 18.9, 18.10, 14.8_

  - [x] 1.2 Add the Worker entry and echo Durable Object
    - Create `src/shared/route.ts` with pure `routeFor(path)` returning `{ kind: "mailbox", pin }`, `{ kind: "echo" }` or `{ kind: "app" }`
    - Create `src/durable/EchoDO.ts` that echoes any text frame back on the same WebSocket
    - Create `src/worker.ts` that routes `/ws/:pin` to the `PinMailbox` binding, `/ws-echo` to `EchoDO`, everything else to the Start handler, and re-exports `PinMailbox` and `EchoDO`
    - Create a placeholder `src/durable/PinMailbox.ts` class so the binding resolves
    - Declare both Durable Object bindings and migrations in `wrangler.jsonc`; run `pnpm cf-typegen`
    - _Requirements: 18.3, 18.4, 18.5, 18.15, 6.2_

  - [x] 1.3 Add reconnecting WebSocket helper and echo page
    - Create `src/shared/backoff.ts` with pure `nextDelay(prev)` (start 1000 ms, double, cap 30000 ms)
    - Create `src/client/net/socket.ts` wrapping native `WebSocket` with indefinite reconnect using `nextDelay`, and a reset-to-1000 hook for successful authentication
    - Create `src/routes/echo.tsx` that sends text to `/ws-echo` and shows the echoed reply
    - _Requirements: 18.15, 18.16, 18.17, 6.10, 6.11_

  - [x] 1.4 Create the steering files under `.kiro/steering`
    - `security.md` with `inclusion: always`: private keys never leave the Local_Store, server never logs plaintext/keys/ciphertext, only `safeLog` allowed in server and durable code, fail closed, no phone or email fields, no PIN linkage data
    - `protocol.md` with `inclusion: fileMatch`, `fileMatchPattern: "src/{shared,durable,server}/**"`: the eleven protocol types, schemas defined once in `src/shared`, validate before any state change, error code table, limits
    - `durable-objects.md` with `inclusion: fileMatch`, `fileMatchPattern: "src/{durable/**,worker.ts}"`: Hibernation API, state in socket attachments and DO storage, alarms, contacts-only relay with independent verification, rate limit persistence
    - `crypto.md` with `inclusion: fileMatch`, `fileMatchPattern: "src/client/crypto/**"`: libsodium only here, crypto_box_easy with fresh 24-byte nonce, Ed25519 signing, canonical encoding, no key logging
    - `bbm-ui.md` with `inclusion: fileMatch`, `fileMatchPattern: "src/{routes,components}/**"`: dark theme with blue accents, rounded contact rows, bubble alignment and marker placement, mobile-first 320-1920 px, no BlackBerry logo or exact BBM icon, reduced motion
    - `cloudflare.md` with `inclusion: auto`, `name: cloudflare`, `description:` Cloudflare Workers deployment for TanStack Start with Durable Objects, wrangler config, secrets and the Neon connection; body covers wrangler.jsonc bindings and migrations, `nodejs_compat`, `wrangler secret put DATABASE_URL`, `.dev.vars`, Neon serverless driver with a fresh client per request
    - _Requirements: 15.1, 17.3, 18.2, 18.5, 18.6, 18.10, 14.8, 14.10_

  - [x] 1.5 Add ESLint import restrictions
    - Configure `no-restricted-imports` so `libsodium-wrappers` is only importable under `src/client/crypto` and `idb` only under `src/client/storage`
    - Forbid imports from `src/client` in files under `src/durable`, `src/server` and `src/db`
    - Add `no-console` for `src/server`, `src/durable` and `src/db`
    - _Requirements: 18.12, 18.13, 17.3_

  - [x] 1.6 Write property test for WebSocket routing
    - **Property 11: WebSocket routing**
    - **Validates: Requirements 6.2, 18.3, 18.4**

  - [x] 1.7 Write property test for reconnect backoff
    - **Property 15: Reconnect backoff**
    - **Validates: Requirements 6.10, 6.11, 18.17**

  - [x] 1.8 Write integration test for the echo Durable Object
    - Connect to `/ws-echo` with `@cloudflare/vitest-pool-workers`, send text, assert same text returned
    - _Requirements: 18.15_

- [x] 2. Shared protocol schemas and types
  - [x] 2.1 Implement shared constants and pure helpers
    - `src/shared/limits.ts` (4096, 8192, 100, 30 per 10 s, ping 10 s, 10 invites per 60 min, 60 s skew, 120 s nonce window, 20 PINs)
    - `src/shared/pin.ts` (`PIN_REGEX`, `isValidPin`, `generatePin(randomBytes)`)
    - `src/shared/marker.ts` (`Marker`, `advance(current, incoming)` as max over clock < D < R)
    - `src/shared/validation.ts` (display name 1-32 trimmed, PIN_Label 1-24 trimmed, Personal_Message 0-80)
    - `src/shared/base64.ts` helpers
    - _Requirements: 2.1, 4.7, 1.5, 3.3, 11.2, 8.11, 15.1_

  - [x] 2.2 Write property test for PIN generation format
    - **Property 1: PIN generation format**
    - **Validates: Requirements 2.1, 4.7**

  - [x] 2.3 Write property test for text field validation
    - **Property 3: Text field validation**
    - **Validates: Requirements 1.2, 1.5, 3.3, 11.2, 11.9**

  - [x] 2.4 Write property test for delivery marker monotonicity
    - **Property 22: Delivery marker monotonicity**
    - **Validates: Requirements 8.1, 8.3, 8.5, 8.9, 8.10, 8.11, 12.5**

  - [x] 2.5 Implement protocol Zod schemas and error codes
    - `src/shared/protocol.ts`: Envelope schema (nonce 24 bytes, ciphertext at most 8192 bytes), discriminated unions for exactly the eleven types, client-to-server schemas including `broadcast` (at most 100 envelopes), `ErrorCode` enum from the design error table (including a `not_delivered` code)
    - A `parseFrame(raw)` helper that handles invalid JSON, unknown type and validation failure, returning only type and field name for errors
    - `src/shared/safeLog.ts`: `safeLog(event, { type, field, code })` accepting no free-form payload
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7, 15.8, 17.3_

  - [x] 2.6 Implement canonical encoding and Signed_Request schema
    - `src/shared/canonical.ts`: deterministic length-prefixed encoding with `"pinme/v1"` domain prefix over pin, action, ts, nonce, payload
    - `src/shared/signed.ts`: `SignedRequest` Zod schema (nonce at least 16 bytes) and action enum
    - _Requirements: 19.1, 19.2, 15.4_

  - [x] 2.7 Write property test for protocol validation
    - **Property 33: Protocol validation discards bad input**
    - **Validates: Requirements 15.2, 15.3, 15.4, 15.5, 15.6, 15.8**

  - [x] 2.8 Write property test for protocol round trip
    - **Property 34: Protocol round trip**
    - **Validates: Requirements 15.9**

  - [x] 2.9 Write property test for canonical encoding injectivity
    - **Property 39: Canonical encoding injectivity**
    - **Validates: Requirements 19.2, 19.8**

- [x] 3. Neon schema and server functions for PIN registration and key lookup
  - [x] 3.1 Implement Drizzle schema, DB client and migrations
    - `src/db/schema.ts` with tables `pins`, `invites`, `contacts`, `burned_pins`, plus `used_nonces`, exactly as in the design (ordered contact pair check, pair-unique invite index)
    - `src/db/client.ts` creating a fresh `@neondatabase/serverless` client per request; fail with `db_not_configured` before any connection when `DATABASE_URL` is missing or empty
    - Drizzle config and generated migration; `db:generate` and `db:migrate` scripts working
    - _Requirements: 18.6, 18.7, 18.11, 2.9, 17.2, 17.4_

  - [x] 3.2 Implement directory service and private-key guard
    - `src/server/guard.ts`: recursively reject bodies with key names matching `/priv|secret/i` with `private_key_not_accepted` before any persistence or logging
    - `src/server/directory.ts`: `registerPin` (validate, reject if in `pins` or `burned_pins`, store public keys, display name, status, personal message) and `getPublicProfile`, written against an injectable repository interface
    - _Requirements: 2.3, 2.4, 2.7, 2.8, 13.14, 17.1, 17.6_

  - [x] 3.3 Expose `registerPin` and `getPublicProfile` as server functions
    - `src/server/functions/pins.ts` using `createServerFn` with Zod validators from `src/shared` and the guard
    - _Requirements: 2.3, 15.4, 4.12_

  - [x] 3.4 Write property test for registration validity and collision safety
    - **Property 4: Registration validity and collision safety**
    - **Validates: Requirements 2.3, 2.4, 2.7, 13.14**

  - [x] 3.5 Write property test for private key field rejection
    - **Property 35: Private key fields rejected**
    - **Validates: Requirements 17.6, 17.3**

  - [x] 3.6 Write unit tests for DB configuration and schema
    - Missing or empty `DATABASE_URL` fails without connecting; table names are exactly `pins`, `invites`, `contacts`, `burned_pins`; no column links PINs of one owner
    - _Requirements: 18.7, 18.11, 2.9_

- [x] 4. Client onboarding, identity, first PIN, keygen and IndexedDB
  - [x] 4.1 Create the minimal Crypto_Module
    - `src/client/crypto/index.ts`: `ready()`, `generatePinKeys()` (X25519 plus Ed25519 pair per PIN), `randomBytes(n)` using libsodium
    - _Requirements: 2.1, 2.2, 2.8_

  - [x] 4.2 Implement the Local_Store
    - `src/client/storage` using idb: stores `identity`, `pins`, `contacts`, `invites`, `messages` with keys and indexes from the design, typed repositories, a transaction helper for multi-store operations
    - _Requirements: 2.8, 7.11, 1.2_

  - [x] 4.3 Implement PIN creation with registration retry
    - `src/client/pins/createPin.ts`: generate PIN and keys, call `registerPin`, on collision discard and retry up to 5 times, persist to Local_Store only after success, surface "PIN creation failed" after 6 collisions; dependencies injected for testing
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 3.5_

  - [x] 4.4 Build the onboarding flow and identity/PIN stores
    - Zustand stores in `src/client/state` for identity and pins (including an active PIN selection)
    - `src/routes/onboarding.tsx`: display name (1-32) and optional picture (image, at most 256 KB) form, validation messages, name retained on picture rejection, no phone or email field, creates identity and the first PIN labeled "Main" within 2 seconds, then shows the PIN
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 4.5 Write property test for per-PIN key uniqueness
    - **Property 2: Per-PIN key uniqueness**
    - **Validates: Requirements 2.2**

  - [x] 4.6 Write property test for registration retry bound
    - **Property 5: Registration retry bound**
    - **Validates: Requirements 2.5, 2.6**

  - [x] 4.7 Write unit tests for the onboarding form
    - Picture at 256 KB accepted and 256 KB + 1 rejected, non-image rejected, no phone or email field, no Identity written on invalid input
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 1.8_

- [x] 5. Crypto helpers with tests
  - [x] 5.1 Implement WebCrypto Ed25519 verify and signature helpers
    - `src/shared/ed25519.ts`: `verifyEd25519(publicKeyRaw, message, signature)` using `crypto.subtle` with raw key import, usable on Workers and in Node tests
    - _Requirements: 19.3, 6.5_

  - [x] 5.2 Complete the Crypto_Module
    - In `src/client/crypto/index.ts` add `encrypt` (crypto_box_easy, fresh 24-byte nonce), `decrypt` (returns null on failure), `signChallenge`, `signRequest` (signs `canonicalize` bytes)
    - _Requirements: 7.1, 7.7, 7.13, 6.4, 19.2_

  - [x] 5.3 Implement signed-request verification
    - `src/server/signedRequest.ts`: `verifySignedRequest(req, deps)` with order shape, PIN exists and active (burn on burned PIN is the no-op exception), timestamp within 60 s, nonce unused in 120 s, Ed25519 verify; error categories `invalid_signature`, `expired_timestamp`, `replay`, `unknown_pin`
    - Drizzle nonce store using `INSERT ... ON CONFLICT DO NOTHING`, recorded only after all other checks pass, opportunistic purge after 120 s
    - _Requirements: 19.1, 19.3, 19.4, 19.5, 19.6, 19.7, 19.9, 11.4, 11.5_

  - [x] 5.4 Write property test for encryption round trip
    - **Property 16: Encryption round trip**
    - **Validates: Requirements 7.1, 7.7, 7.12**

  - [x] 5.5 Write property test for nonce freshness
    - **Property 17: Nonce freshness**
    - **Validates: Requirements 7.13**

  - [x] 5.6 Write property test for challenge signature verification
    - **Property 13: Challenge signature verification**
    - **Validates: Requirements 6.4, 6.5, 6.6**

  - [x] 5.7 Write property test for signed request verification outcome
    - **Property 37: Signed request verification outcome**
    - **Validates: Requirements 11.3, 11.4, 11.5, 13.12, 19.3, 19.4, 19.5, 19.6, 19.7, 19.9**

  - [x] 5.8 Write property test for tamper detection
    - **Property 38: Tamper detection**
    - **Validates: Requirements 19.8**

  - [x] 5.9 Checkpoint - Ensure all tests pass
    - Ensure all tests pass, ask the user if questions arise.

- [x] 6. PinMailbox with signed-challenge handshake
  - [x] 6.1 Implement rate limiter and pair cache
    - `src/durable/ratelimit.ts`: pure sliding-window `allow(key, now, limit, windowMs)` returning `{ ok, retryAfterMs }`, state serializable for DO storage
    - `src/durable/paircache.ts`: 5 s TTL cache with `invalidate()`, fail closed with `verification_unavailable` when Directory is unreachable and the pair is not cached
    - _Requirements: 16.2, 16.5, 16.6, 4.13, 7.10, 9.4_

  - [x] 6.2 Implement PinMailbox connection and handshake
    - `src/durable/directoryClient.ts` for key, burned and pair lookups through Drizzle
    - `PinMailbox.fetch`: Hibernation API `acceptWebSocket`; unregistered or burned PIN gets `error(pin_unavailable)` then close with no challenge; otherwise 32 random bytes in socket attachment, alarm at +10 s
    - `webSocketMessage`: `parseFrame` first, ignore everything except `challengeResponse` while unauthenticated, verify Ed25519 and mark authenticated, close on bad signature or timeout via `alarm()`
    - _Requirements: 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 6.9, 6.12, 15.2_

  - [x] 6.3 Implement client handshake and message dispatch
    - Extend `src/client/net/socket.ts` to sign the received challenge and send `challengeResponse`, reset backoff on authentication, stop reconnecting on `pin_unavailable`
    - `src/client/net/dispatch.ts`: validate frames with the shared schemas and route to a handler registry; `src/client/state/connection.ts` store
    - _Requirements: 6.1, 6.4, 6.10, 6.11, 15.3_

  - [x] 6.4 Write property test for the sliding-window rate limiter
    - **Property 8: Sliding-window rate limiter**
    - **Validates: Requirements 4.13, 7.10, 9.4, 9.5, 12.7**

  - [x] 6.5 Write property test for pair removal
    - **Property 21: Pair removal takes effect**
    - **Validates: Requirements 16.2, 16.5, 16.6**

  - [x] 6.6 Write property test for challenge uniqueness and size
    - **Property 12: Challenge uniqueness and size**
    - **Validates: Requirements 6.3**

  - [x] 6.7 Write property test that unauthenticated sockets are inert
    - **Property 14: Unauthenticated sockets are inert**
    - **Validates: Requirements 6.8**

  - [x] 6.8 Write integration tests for the handshake
    - Miniflare: valid handshake, invalid signature closes, 10 s timeout with fake timers, burned and unknown PIN, hibernation eviction and resume
    - _Requirements: 6.5, 6.6, 6.7, 6.9, 6.12_

- [x] 7. Invites and contact list
  - [x] 7.1 Add invite support to PinMailbox
    - RPC methods `checkInviteQuota()` (10 per 60 min, persisted), `pushNotice(notice)` (invite, accepted), `invalidatePairs()`; held notices stored under `notice:*` and flushed after authentication
    - _Requirements: 4.2, 4.3, 4.13, 16.2_

  - [x] 7.2 Implement invite server functions
    - `src/server/invites.ts` and `src/server/functions/invites.ts`: `sendInvite` (Signed_Request, checks for format, not found, burned, self, duplicate, quota via mailbox), `respondInvite` (accept inserts ordered contact pair, deletes invite, invalidates both mailboxes, pushes `accepted`; decline deletes invite)
    - _Requirements: 4.1, 4.4, 4.5, 4.8, 4.9, 4.10, 4.11, 13.11_

  - [x] 7.3 Implement client invite flow and contact store
    - `src/client/state/contacts.ts`, `src/client/net/handlers/invites.ts` for `inviteNotice` (invite and accepted), accept stores the Contact public keys in Local_Store, opens the chat, send invite with format validation before any request
    - _Requirements: 4.6, 4.7, 4.12, 14.4, 14.5, 14.6_

  - [x] 7.4 Build home contact list and add-contact UI
    - `src/routes/index.tsx` home with rounded contact rows (picture or default placeholder, name, status dot, single-line truncated Personal_Message), pending invites with accept and decline; `src/routes/add.tsx` add contact form
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.9, 14.11, 11.8_

  - [x] 7.5 Write property test for invite decisions and transitions
    - **Property 7: Invite decision and state transitions**
    - **Validates: Requirements 4.1, 4.4, 4.5, 4.8, 4.9, 4.10, 4.11**

  - [x] 7.6 Write integration test for the invite flow
    - Two mailboxes: online delivery of inviteNotice, held notice delivered after connect, accept notifies inviter
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 7.7 Write unit tests for contact list UI
    - Row layout, placeholder picture, ellipsis truncation, accept/decline success and failure
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 14.6_

- [x] 8. Real-time encrypted chat with offline storage in the DO
  - [x] 8.1 Implement message relay and outbox in PinMailbox
    - `src/durable/outbox.ts` pure helpers for `env:{ts}:{messageId}` keys, 30-day purge and delete retry bookkeeping (`sentToSocket` flag, max 3 retries at 5 s)
    - `onMessage`: schema check, rate limit 30 per 10 s, contacts-only check, reject burned recipient, forward via recipient mailbox `deliver()` which re-verifies the pair independently; deliver to all authenticated sockets or store; flush stored envelopes on authentication and delete within 5 s of delivery; alarm purges envelopes older than 30 days
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.10, 16.1, 16.3, 16.4, 17.1, 17.5, 17.7, 17.8_

  - [x] 8.2 Implement client send and receive pipeline
    - `src/client/chat/send.ts` (encrypt, Message_ID UUID, clock marker within 500 ms, disabled while disconnected), `src/client/chat/receive.ts` (validate, decrypt, discard silently on failure, persist), `src/client/net/handlers/message.ts`, `src/client/state/chat.ts`
    - _Requirements: 7.1, 7.2, 7.7, 7.8, 7.11, 8.1_

  - [x] 8.3 Build the chat UI
    - `src/routes/chat.$pin.tsx`, `src/components/MessageBubble.tsx` (sent right with Delivery_Marker, received left without), `src/components/MessageInput.tsx` (1-4096 characters), not-found panel with link home for unknown PIN
    - _Requirements: 14.7, 14.11, 14.12, 8.6, 7.1_

  - [x] 8.4 Write property test for mailbox store-and-forward
    - **Property 19: Mailbox store-and-forward**
    - **Validates: Requirements 7.4, 7.5, 7.6, 9.8, 10.7, 17.5**

  - [x] 8.5 Write property test for the contacts-only relay gate
    - **Property 20: Contacts-only relay gate**
    - **Validates: Requirements 7.3, 7.9, 8.7, 8.8, 9.7, 10.6, 16.1, 16.3, 16.4**

  - [x] 8.6 Write property test for envelope expiry and deletion retry
    - **Property 36: Envelope expiry and deletion retry**
    - **Validates: Requirements 17.7, 17.8**

  - [x] 8.7 Write property test that failed decryption leaves no trace
    - **Property 18: Failed decryption leaves no trace**
    - **Validates: Requirements 7.8**

  - [x] 8.8 Write unit tests for chat UI
    - Bubble alignment, marker only on sent bubbles, input length limits
    - _Requirements: 8.6, 14.7_

  - [x] 8.9 Checkpoint - Ensure all tests pass
    - Ensure all tests pass, ask the user if questions arise.

- [x] 9. D/R receipts and typing indicator
  - [x] 9.1 Add receipts and typing relay to PinMailbox
    - `onReceipt` for `delivered` and `read` (contacts-only, discard otherwise), `onTyping` (contacts-only with error to sender on rejection, discard without storing or error when recipient offline)
    - _Requirements: 8.7, 8.8, 10.6, 10.7_

  - [x] 9.2 Implement client receipts
    - `src/client/net/handlers/receipts.ts`: apply `advance` to markers, ignore unknown Message_IDs, jump straight to R if needed; send `delivered` within 5 s of save and exactly one `read` within 5 s of display while the chat is visible
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.9, 8.10, 8.11_

  - [x] 9.3 Implement typing indicator
    - `src/client/chat/typing.ts` pure throttle (at most 1 per 3 s, stop on empty or send) and visibility state (5 s timeout, hidden on message arrival), `src/components/TypingIndicator.tsx` showing "Name is writing a message...", wire into `MessageInput`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 9.4 Write property test for typing throttle
    - **Property 23: Typing throttle**
    - **Validates: Requirements 10.1, 10.2**

  - [x] 9.5 Write property test for typing indicator visibility
    - **Property 24: Typing indicator visibility**
    - **Validates: Requirements 10.3, 10.4, 10.5**

- [x] 10. PING with rate limiting
  - [x] 10.1 Add ping handling to PinMailbox
    - `onPing`: contacts-only, one ping per contact per 10 s with `rate_limited` and `retryAfterSec`, discard without storing and return `not_delivered` if recipient has no authenticated socket
    - _Requirements: 9.4, 9.5, 9.7, 9.8_

  - [x] 10.2 Implement client PING
    - `src/components/PingButton.tsx` (send within 1 s, disable until retry time expires, show not-delivered indication within 2 s), `src/client/net/handlers/ping.ts` (shake window 1 s, play sound once, vibrate 500 ms where supported), `src/styles/shake.css` honoring `prefers-reduced-motion`, wire button into the chat route
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.9_

  - [x] 10.3 Write unit tests for client PING
    - Mocked vibration and audio, button re-enable with fake timers, not-delivered indication
    - _Requirements: 9.2, 9.3, 9.6, 9.9_

- [x] 11. Status, personal message and broadcast
  - [x] 11.1 Implement profile update server function
    - `src/server/profile.ts` and `src/server/functions/profile.ts`: Signed_Request `updateProfile` for status, personal message (at most 80) and display name; update Directory and push presence `inviteNotice` (kind `presence`) to each contact mailbox
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.9, 19.1_

  - [x] 11.2 Add presence retention to PinMailbox
    - Store the latest presence per sender under a replaceable key, deliver after next authentication, push within 5 s
    - _Requirements: 11.6, 11.7_

  - [x] 11.3 Implement broadcast processing in PinMailbox
    - `src/durable/broadcast.ts` pure `processBroadcast`: reject whole message over 100 envelopes, per-envelope contact check with continue, stop at first rate-limited envelope and reject the rest, one rate-limit count per envelope; wire `onBroadcast` into `PinMailbox`
    - _Requirements: 12.3, 12.6, 12.7, 12.8, 12.10_

  - [x] 11.4 Implement client status and personal message editing
    - `src/components/StatusEditor.tsx` (Available or Busy, 0-80 character message), `src/client/profile/update.ts` signing and sending within 2 s, error shown while keeping last saved values, `src/client/net/handlers/presence.ts` updating contact rows
    - _Requirements: 11.1, 11.2, 11.3, 11.8, 11.10_

  - [x] 11.5 Implement client broadcast
    - `src/client/chat/broadcast.ts` building one envelope per accepted contact with distinct Message_IDs and nonces (at most 100), error when no contacts; `src/routes/broadcast.tsx` composer showing a per-contact Delivery_Marker; received broadcasts appear in the one-to-one chat
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.9_

  - [x] 11.6 Write property test for presence retention
    - **Property 25: Presence retention**
    - **Validates: Requirements 11.6, 11.7**

  - [x] 11.7 Write property test for broadcast processing
    - **Property 27: Broadcast processing**
    - **Validates: Requirements 12.3, 12.6, 12.8, 12.10**

  - [x] 11.8 Write property test for broadcast construction
    - **Property 26: Broadcast construction**
    - **Validates: Requirements 12.1, 12.2**

- [x] 12. Multiple PINs, PIN manager and burn flow with ghost animation
  - [x] 12.1 Implement multi-PIN management on the client
    - `src/client/pins/manage.ts`: create additional PIN with label (1-24), limit 20, local-only rename, one WebSocket per active PIN via `src/client/net/manager.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.1_

  - [x] 12.2 Build the PIN manager UI
    - `src/routes/pins.tsx` and `src/components/PinCard.tsx`: list of Active_PINs with label and contact count (0 when none), create, rename, detail view with `StatusEditor`
    - _Requirements: 3.2, 3.7, 14.11, 11.1_

  - [x] 12.3 Implement burn in PinMailbox
    - `burn()`: close all sockets, delete queued data, set `meta:burned`, refuse further connections; `contactBurned(pin)` notice sent to connected contacts and held otherwise; reject messages to burned PINs
    - _Requirements: 13.5, 13.9, 13.11_

  - [x] 12.4 Implement burn server function
    - `src/server/burn.ts` and `src/server/functions/burn.ts`: Signed_Request, transaction inserting `burned_pins` with key, deleting `pins` row, invites and contacts; call mailbox `burn()` and notify former contacts; repeated burn returns success with no change; other PINs unaffected
    - _Requirements: 13.3, 13.4, 13.6, 13.9, 13.12, 13.14, 13.15, 13.16_

  - [x] 12.5 Implement client burn flow and ghost animation
    - Confirmation dialog with PIN_Label and permanence warning (confirm and cancel), signed burn request with 10 s timeout, `src/components/GhostAnimation.tsx` (`src/styles/ghost.css`, reduced-motion aware), `src/client/storage/burnCleanup.ts` single-transaction removal of the PIN's keys, contacts and conversations after the animation, `contactBurned` handler marking the chat unavailable, disabling input and rejecting sends
    - _Requirements: 13.1, 13.2, 13.3, 13.7, 13.8, 13.10, 13.13, 25.4, 25.5_

  - [x] 12.6 Write property test for PIN count limit
    - **Property 6: PIN count limit**
    - **Validates: Requirements 3.1, 3.4**

  - [x] 12.7 Write property test for burn directory effects
    - **Property 28: Burn directory effects**
    - **Validates: Requirements 13.4, 13.6, 13.9, 13.15**

  - [x] 12.8 Write property test for burn idempotence
    - **Property 29: Burn idempotence**
    - **Validates: Requirements 13.16**

  - [x] 12.9 Write property test that a burned PIN is unreachable
    - **Property 30: Burned PIN is unreachable**
    - **Validates: Requirements 13.5, 13.11, 13.14**

  - [x] 12.10 Write property test for scoped local burn cleanup
    - **Property 31: Local burn cleanup is scoped**
    - **Validates: Requirements 13.8**

  - [x] 12.11 Write property test for contact marked unavailable on burn
    - **Property 32: Contact marked unavailable on burn**
    - **Validates: Requirements 13.10, 25.5**

  - [x] 12.12 Write unit tests for the burn dialog and failures
    - Cancel leaves everything unchanged, network error or 10 s timeout keeps data and skips animation
    - _Requirements: 13.1, 13.2, 13.13_

  - [x] 12.13 Checkpoint - Ensure all tests pass
    - Ensure all tests pass, ask the user if questions arise.

- [x] 13. QR barcode show and scan
  - [x] 13.1 Implement Barcode component and scan classifier
    - `src/components/Barcode.tsx` using `qrcode`, BBM-inspired styling without the BBM icon, at least 200 by 200 CSS px next to the PIN text
    - `src/shared/scan.ts`: pure `classifyScan(text, ownPins)` returning `accept`, `own-pin` or `invalid`
    - _Requirements: 5.1, 5.3, 5.5, 5.7, 14.10_

  - [x] 13.2 Implement the scanner
    - `src/components/Scanner.tsx` using `html5-qrcode`: request permission, on valid PIN stop within 1 s, close camera and prefill the add-contact flow; invalid or own PIN shows a message and keeps scanning; denied or no camera offers manual entry; cancel closes camera within 1 s
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.7, 5.8_

  - [x] 13.3 Wire the Barcode into onboarding and PIN detail
    - Show PIN and Barcode right after identity creation in `src/routes/onboarding.tsx` and in the PIN detail view in `src/routes/pins.tsx`
    - _Requirements: 1.4, 5.1_

  - [x] 13.4 Write property test for scan classification
    - **Property 9: Scan classification**
    - **Validates: Requirements 5.3, 5.5, 5.7**

  - [x] 13.5 Write property test for barcode round trip
    - **Property 10: Barcode round trip**
    - **Validates: Requirements 5.6**

  - [x] 13.6 Write unit tests for the scanner
    - Mocked permission denied, no camera, cancel
    - _Requirements: 5.4, 5.8_

- [x] 14. Polish, README and two-window demo check
  - [x] 14.1 Polish theme, responsiveness and branding
    - Verify dark theme tokens meet 4.5:1, mobile-first layout from 320 px to 1920 px with no horizontal scroll, all routes reachable (home, chat, PIN manager, add contact), no BlackBerry logo or exact BBM icon in assets
    - _Requirements: 14.8, 14.9, 14.10, 14.11_

  - [x] 14.2 Write the README
    - Root `README.md` with sections: no forward secrecy (later key compromise decrypts captured ciphertext), what the server can see (public data, PINs, ciphertext sizes, timing) and cannot see (plaintext, private keys), Burn guarantee and its limit (cannot erase messages on contacts' devices), Known limitations, setup (install, run locally, test, deploy) and the name and purpose of DATABASE_URL and any other secrets without values
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

  - [x] 14.3 Write Playwright two-window demo test
    - Two isolated browser contexts through the demo flow: show PIN, add, accept, messages with D then R, PING shake, create "Marketplace" PIN, add, burn with ghost animation, window B chat disabled within 2 s, send to burned PIN rejected; capture traffic and Directory rows and assert no message text or "Marketplace" appears
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6_

  - [x] 14.4 Write config, README and contrast smoke tests
    - `wrangler.jsonc` has DO bindings, migrations and `nodejs_compat`; package scripts exist; `.dev.vars` is gitignored; README has required sections; theme contrast at least 4.5:1; lint fails on forbidden imports
    - _Requirements: 18.5, 18.9, 18.10, 18.12, 18.13, 20.1, 20.2, 20.3, 20.5, 14.8_

  - [x] 14.5 Final checkpoint - Ensure all tests pass
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Each of the 39 correctness properties has exactly one optional property test sub-task
- Requirement 18.14 asks for Vitest tests of crypto, protocol validation, rate limiting and burn logic; these are the optional property tests 5.4 to 5.8, 2.7 to 2.9, 6.4 and 12.7 to 12.9
- Optional requirements 21-24 are intentionally excluded
- Run `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm cf-typegen` and `pnpm build` at checkpoints

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5", "2.1", "4.1", "4.2", "5.1"] },
    { "id": 2, "tasks": ["1.6", "1.7", "1.8", "2.2", "2.3", "2.4", "2.5", "2.6", "4.5", "6.1", "13.1"] },
    { "id": 3, "tasks": ["2.7", "2.8", "2.9", "3.1", "5.2", "6.4", "6.5", "13.4", "13.5"] },
    { "id": 4, "tasks": ["3.2", "5.3", "5.4", "5.5", "5.6", "6.2", "6.3"] },
    { "id": 5, "tasks": ["3.3", "3.4", "3.5", "3.6", "5.7", "5.8", "6.6", "6.7", "6.8", "7.1"] },
    { "id": 6, "tasks": ["4.3", "7.2", "8.1"] },
    { "id": 7, "tasks": ["4.4", "4.6", "7.5", "7.6", "8.4", "8.5", "8.6", "9.1", "11.1"] },
    { "id": 8, "tasks": ["4.7", "7.3", "10.1", "12.1"] },
    { "id": 9, "tasks": ["7.4", "8.2", "11.2", "12.6"] },
    { "id": 10, "tasks": ["7.7", "8.3", "8.7", "9.2", "11.3", "11.4", "11.6", "13.2"] },
    { "id": 11, "tasks": ["8.8", "9.3", "11.5", "11.7", "12.2", "12.3", "13.6"] },
    { "id": 12, "tasks": ["9.4", "9.5", "10.2", "11.8", "12.4"] },
    { "id": 13, "tasks": ["10.3", "12.5", "12.7", "12.8", "12.9"] },
    { "id": 14, "tasks": ["12.10", "12.11", "12.12", "13.3"] },
    { "id": 15, "tasks": ["14.1", "14.2"] },
    { "id": 16, "tasks": ["14.3", "14.4"] }
  ]
}
```
