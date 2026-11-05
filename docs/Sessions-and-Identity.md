# Sessions and Identity

## Session key

Active sessions are keyed by **`(ip, username)`**, not IP alone.

In-memory row (`lib/serverBackgroundSessions.ts`):

```ts
{ ip, username, module, startTimeMs, lastActivityMs }
```

Constants: `SESSION_INACTIVITY_MS = 5 * 60 * 1000` (`lib/sessionConstants.ts`).

## Identity sources

Username is resolved from, in priority order depending on the line format:

- oc4d morgan token `user=<email>` (or similar)
- HTTP auth / remote-user style fields in the journal line
- Query / header fragments parsed by `lib/oc4dLogLine.ts`
- Heartbeat `user` query param
- Default: **`Guest`**

`normalizeIdentityValue()` strips user-related prefixes and normalizes empty / anonymous values to Guest (or empty, then Guest at the call site).

## Display names

Log / heartbeat identity is typically an **email**. The UI shows `displayName` from the shared `User` table when `User.email` matches (case-insensitive). Cache: `lib/userPoolCache.ts`; HTTP: `GET /api/user-pool`.

## Guest → logged-in collapse

When a logged-in user appears at an IP that still has a **Guest** row, the Guest session is ended and removed so the panel does not show two rows for the same device. Heuristic: same IP, Guest username, any module (typical LAN = one device per IP).

## Entry vs activity

| Signal | Effect |
|--------|--------|
| Entry `index.html` (or equivalent) GET in journal | Start or switch module for that `(ip, username)` |
| Asset / non-entry GET for the **same** module | Bump `lastActivityMs` only |
| Asset GET for a **different** module | Must **not** steal the active session (unrelated-module heartbeats ignored for switch) |
| Heartbeat `ping` | Seed or refresh session for `slug` |
| Heartbeat `close` | End matching session and persist duration |
| Idle > 5 minutes | Cleanup removes row; duration anchored to `lastActivityMs` |

## Duration rules

- **While live:** `duration = floor((now - startTimeMs) / 1000)` so the dashboard ticks even for static HTML pages whose assets stop after the initial burst.
- **On end (idle cleanup):** duration uses `lastActivityMs - startTimeMs` so closed-tab / idle sessions do not inflate until the sweep fires.
- **0-second records** are not written to the session log (noise from sub-second module thrash).

Persisted `userId` format: `{username}|{ip}` (e.g. `teacher@example.com|192.168.1.20`).

## Loopback filtering

Traffic from `127.0.0.1`, `::1`, and `127.*` is dropped from session analytics unless `MODULEGAZE_INCLUDE_LOOPBACK=1`. This keeps Pi health-check / local curl noise out of the live panel.
