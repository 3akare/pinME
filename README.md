# PinMe

PinMe is a web messenger that brings back the PIN-based identity of BBM. You chat with anyone using an 8-character PIN (for example `2A4F9C1B`) instead of a phone number or email. One person can hold several labeled PINs, and burning a PIN permanently cuts off every contact who only knew that PIN. The server keeps no account that links your PINs together.

Messages are end-to-end encrypted in the browser. The server is a directory of public data and a relay of ciphertext. It deletes ciphertext after delivery and keeps no message history.

Stack: TanStack Start (React) on a single Cloudflare Worker, one Durable Object (`PinMailbox`) per PIN, Neon Postgres via Drizzle for the directory, libsodium for crypto, IndexedDB for local storage.

## Forward secrecy

Messages, broadcasts and group messages use the Signal design: X3DH to start a session and the Double Ratchet for every message after it (X25519, keyed BLAKE2b, XChaCha20-Poly1305, all from libsodium). Each message has its own key, deleted once used, and the keys keep moving forward, so someone who later steals a device or a copied browser profile cannot decrypt messages captured earlier.

- Each PIN publishes a signed prekey (rotated weekly) and a pool of one-time prekeys to its own mailbox. Only the PIN's contacts and group-mates can fetch them.
- Opening a chat, or gaining a contact, prepares the session in the background, so the first message is not delayed.
- Fallback without forward secrecy: a peer that has never published prekeys (an older client) still gets the original `crypto_box_easy` encryption with long-lived keys, and so do messages already stored from before this change.
- A backup file holds the current ratchet state and your chat history, so it should be kept as safely as the device itself.

## What the server can see

The server can see:

- Public data: display names, public keys (X25519 and Ed25519), Presence_Status and Personal_Message of each PIN.
- PINs: which PINs exist, which are burned, pending invites and accepted contact pairs between PINs.
- Ciphertext sizes.
- Message timing: when envelopes, delivery and read markers, pings and typing events are sent and to whom.
- Group membership: which PINs are in a group together, so it can relay messages between members who are not contacts. Group names and messages are encrypted; the server cannot tell which group a message belongs to.
- If you turn on notifications: one push endpoint per PIN (from your browser's push service). Each PIN subscribes from its own service-worker scope, so the endpoints of your PINs differ and are not linked to each other. Pushes are empty wake-ups: the push service and the server see when a PIN is woken, never what arrived.

The server cannot see:

- Plaintext message content.
- Private keys. They stay in the browser's IndexedDB and are never transmitted.

The server also does not receive or store phone numbers or email addresses, and stores nothing that links one of your PINs to another.

## Burn guarantee

Burning a PIN cuts off relay and directory access for that PIN permanently. The PIN is marked burned and is never reissued. Its WebSocket connections are closed, its queued messages are deleted, its invites and contact pairs are removed from the directory, and further messages or invites to it are rejected. Former contacts are notified and their chat with that PIN becomes unavailable.

Limit: burning cannot erase messages already stored on your contacts' devices. Anything a contact received before the burn stays in their local storage, and a contact could have copied or screenshotted it.

## Known limitations

- Forward secrecy needs both sides on a current client (see above); with an older peer, messages fall back to long-lived keys.
- The server sees metadata: PINs, contact relationships, ciphertext sizes and timing.
- Private keys and message history live only in the browser's IndexedDB. Clearing browser data or losing the device loses them unless you made a backup (More > Back up): a file encrypted with your passphrase (PBKDF2-SHA-256, 600,000 iterations, AES-256-GCM) that you keep yourself. There is no server-side backup, and a lost passphrase cannot be recovered. A backup restores only onto a device without an identity, and messages that arrived after it are not in it.
- Burning does not delete messages already on contacts' devices.
- The server relays your IP address to Cloudflare and the hosting stack as normal for any web service. PinMe does not hide network-level identity.
- Groups hold at most 10 members, and only contacts of the creator can be added. The server knows who is in a group together (not its name or messages).

## Notifications (installable app)

PinMe installs as an app (web manifest and service worker). With notifications on, a PIN that has a message or request waiting while you are offline gets one empty wake-up push, at most once a minute, and your device shows "You have a new message or request." The content still only arrives over the encrypted connection when you open the app. On iPhone, notifications work once PinMe is added to the Home Screen.

## Setup

Requirements: Node.js and pnpm (`packageManager` is `pnpm@10.7.0`), a Neon Postgres database, and a Cloudflare account for deployment.

### Install

```sh
pnpm install
```

### Configuration

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection string for the Directory. Used by the Worker at runtime and by `drizzle-kit` for migrations. |
| `VAPID_PRIVATE_KEY` | Secret. Private half (the `d` value, base64url) of the P-256 key pair that signs wake-up pushes. Without it, notifications are simply off. |
| `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | Public vars in `wrangler.jsonc`: the matching public key browsers subscribe with, and a contact URL for push services. |

No other secrets are required. Never commit the value.

For local development, copy `.dev.vars.example` to `.dev.vars` and set `DATABASE_URL`. For migrations, export it in your shell:

```sh
cp .dev.vars.example .dev.vars
export DATABASE_URL="<your Neon connection string>"
```

### Database

```sh
pnpm db:generate   # generate SQL migrations from src/db/schema.ts
pnpm db:migrate    # apply migrations to DATABASE_URL
```

### Run locally

```sh
pnpm dev
```

### Test and lint

```sh
pnpm test
pnpm lint
```

#### End-to-end demo test (Playwright)

`pnpm test:e2e` runs the two-window demo flow in `e2e/` against a real Neon database. It needs `DATABASE_URL` in your environment or in `.dev.vars` (the dev server reads `.dev.vars`) and a migrated database. The test skips itself with a message when `DATABASE_URL` is missing. Install the browser once with `pnpm exec playwright install chromium`. `pnpm test` (vitest) does not run these files.

### Build

```sh
pnpm build
```

### Deploy

Set the secret once, then deploy:

```sh
wrangler secret put DATABASE_URL
pnpm deploy
```

`pnpm deploy` runs `pnpm run build` and then `wrangler deploy`.
