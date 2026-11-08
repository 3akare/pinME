---
inclusion: fileMatch
fileMatchPattern: "src/{durable/**,worker.ts}"
---

# Durable Object rules

- Use the Hibernation API: `ctx.acceptWebSocket(ws)` with `webSocketMessage`, `webSocketClose`, `webSocketError` handlers. Never use `ws.accept()` or `addEventListener`.
- In-memory state is lost on hibernation. Per-connection state (authenticated, challenge, challengeExpiresAt) lives in `ws.serializeAttachment()`. Everything else lives in DO storage (envelopes `env:*`, notices `notice:*`, rate-limit arrays `rl:*`, `meta:burned`).
- Use alarms (`ctx.storage.setAlarm`) for the 10 s challenge timeout, 30-day envelope expiry (delete within 24 h of the mark), and delete retries (max 3, 5 s apart, never re-deliver).
- Delete a stored envelope within 5 s of delivery. Ephemeral items (ping, typing) are never stored.
- Contacts-only relay: before relaying message, ping, typing, delivered, read or broadcast envelope, verify the accepted Contact pair. The receiving mailbox verifies the pair independently of the sender's mailbox.
- Pair cache has a 5 s TTL and is cleared by `invalidatePairs()`. If the Directory is unreachable and the pair is not cached, drop the item and return `verification_unavailable`. A removed pair is never honored, even if cached.
- Rate limit counters persist in DO storage so hibernation does not reset them.
- Unauthenticated sockets ignore everything except a valid `challengeResponse`.
- `src/worker.ts` routes `/ws/:pin` (valid PIN) to `PIN_MAILBOX.idFromName(pin)`, everything else to the Start handler, and re-exports `PinMailbox`.
- Do not import from `src/client`. Log only through `safeLog`.
