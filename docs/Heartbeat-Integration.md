# Heartbeat Integration

Pure-static module pages emit few GETs after the initial asset burst. Without heartbeats, duration and “still present” detection under-count until idle timeout. oc4d injects a small script into module pages that calls Module Gaze.

**Injection lives in oc4d-server, not this repository.** This page documents the contract Gaze implements.

## Endpoint

```http
POST /api/module-heartbeat?slug=<moduleSlug>&event=ping|close&user=<optionalIdentity>
```

- No body
- CORS open (`*`) so pages on `oc4d.cdn`, LAN IP, or hotspot IP can POST
- Client IP from `x-forwarded-for` or direct connection

## Events

| `event` | Behavior |
|---------|----------|
| `ping` | `recordModuleHeartbeat(ip, username, slug)` — create or refresh row; may seed a session if monitoring started after the user already opened the page |
| `close` | `endModuleSession(ip, username, slug)` — remove row and persist duration if ≥ 1s |

`user` is normalized; empty → `Guest`.

## Preconditions (silent `204` discard)

Heartbeats are accepted and discarded (no error) when:

- Background monitor is **off** (store would not be maintained otherwise)
- Client IP cannot be determined
- IP is loopback and `MODULEGAZE_INCLUDE_LOOPBACK` is not enabled

## Deployed oc4d client behavior

- Send one `ping` immediately, then every 30 seconds while the tab is visible, using the stable module **slug**.
- Do not send `close` on `pagehide` or `beforeunload`. These events also fire during navigation within a module; closing the session then would reset its duration on the next page.
- After the last journal or heartbeat activity, the session remains in the live list until the five-minute inactivity timeout. Cleanup saves duration through `lastActivityMs`, excluding the idle wait.

The endpoint still supports `close` for callers that explicitly end a matching session, but the deployed oc4d script does not send it. A hidden tab also stops periodic pings and can time out if no other activity arrives.

## Relation to journal lines

Heartbeats and journal parsing share the same in-memory store. Asset GETs for unrelated modules must not steal the active session; heartbeats follow the same rule for module switches.
