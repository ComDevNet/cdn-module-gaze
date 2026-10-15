# Troubleshooting

## Live sessions panel empty while monitor is “on”

- Confirm `MODULEGAZE_BACKGROUND_MONITOR=1` in the running unit: `systemctl show cdnmodulegaze -p Environment`
- Confirm `GET /api/live-sessions` returns `"enabled": true`
- Shared state must be pinned on `globalThis` (`Symbol.for`); a regression that creates separate stores per chunk shows empty UI while journal processing still runs
- On Windows / local Next without journalctl, the monitor will not start

## Everyone shows as Guest

- oc4d access logs must include a usable identity (e.g. morgan `user=<email>`)
- Heartbeat script should pass `user=` when known
- Check `GET /api/user-pool` — emails must exist in `User` for display names (Guest vs missing display name are different issues)

## Phantom modules (`img`, `asset`, `style`, …)

Slug parser must use the **first** stable path segment, not the last. See [Log Parsing](Log-Parsing.md). If old session logs contain phantoms, they were written before that fix.

## Duration stuck at 0s or thrashing

- Live rows tick from `startTime` while present; if the UI oscillates, ensure poll + local tick are not fighting (dashboard logic)
- Unrelated-module heartbeats/assets must not switch the active session
- Idle end duration is anchored to `lastActivityMs`

## Guest + logged-in duplicate rows

Expect collapse when a non-Guest identity appears at the same IP. If both persist, identity normalization may not be treating the logged-in value as non-Guest, or IPs differ (NAT / proxy).

## Ingest returns 401

`MODULEFETCH_INGEST_SECRET` is set on the server but the client did not send `x-modulefetch-secret` or `Authorization: Bearer …`. Unset the secret if open LAN ingest is intended.

## `/api/modules` empty or scan count 0

- Verify `MODULEGAZE_UPLOADS_MODULES_ROOT` matches the real uploads tree on the Pi (`/home/pi/oc4d-server/...` vs `/oc4d-server/...`)
- Inspect `sources` and `warnings` in the JSON response
- Confirm `DATABASE_URL` reaches the oc4d database

## Loopback / health-check noise in the panel

Default behavior drops `127.0.0.1` / `::1`. Only set `MODULEGAZE_INCLUDE_LOOPBACK=1` for intentional local testing.

## Service did not pick up new env or build

`install.sh` **restarts** the unit after copy. If you edited the unit by hand, run `daemon-reload` + `restart`. `systemctl start` alone after a previous failed start may leave stale env.
