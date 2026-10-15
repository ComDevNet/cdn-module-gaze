# CDN Module Gaze — Developer Wiki

One-page technical reference for maintainers and onboarding. Day-one install lives in the [README](../README.md).

| | |
|--|--|
| **What it is** | Live admin dashboard of who is viewing which CDN learning modules |
| **Where it runs** | Beside `oc4d.service` on a CLC Pi (port **3002**) |
| **Stack** | Bun · Next.js 15 · React 19 · Prisma · PostgreSQL · systemd |
| **Unit name** | `cdnmodulegaze.service` |

### Contents

1. [How the system works](#1-how-the-system-works)
2. [Database & data](#2-database--data)
3. [API contracts](#3-api-contracts)
4. [Run it (local & production)](#4-run-it-local--production)
5. [Env vars](#5-env-vars)
6. [Troubleshooting](#6-troubleshooting)
7. [Code map](#7-code-map)

---

## 1. How the system works

Gaze does **not** invent its own user DB. It:

1. Reads the **same Postgres** as oc4d (`Module`, `Category`, `User`)
2. Follows **`journalctl -u oc4d.service`** for module page requests
3. Optionally accepts **browser heartbeats** from module HTML (injected by oc4d)
4. Keeps **live sessions in memory**, shows them in the UI, and writes duration logs to disk

```text
oc4d.service ──journalctl──▶ journal hub ──▶ session store ──▶ UI
                                  ▲                │
module pages ──/api/module-heartbeat──┘                │
                                                       ▼
                                          /var/log/modulegaze/
```

### Production mode (default on the Pi)

`MODULEGAZE_BACKGROUND_MONITOR=1` → on startup, `instrumentation.ts` starts the journal follower. **Sessions are tracked even if no browser has the dashboard open.** The UI polls `GET /api/live-sessions`. Buttons are **Pause / Resume live view** (they do not stop tracking).

### Fallback mode

If the background monitor is off, the dashboard **auto-starts** SSE monitoring on load (`GET /api/logs/stream`), parses lines in the browser, and can flush sessions with `POST /api/modulefetch/ingest`. The Start / Stop controls still pause or resume that browser-side path.

### Platform note (Windows)

`journalctl` does not exist on Windows, so the journal follower never starts. If the env flag is still set, `/api/live-sessions` reports `enabled: true`, but journal-based sessions stay empty. Heartbeats can still update the in-memory store when the env flag is on.

---

## 2. Database & data

### Shared Postgres (Prisma)

File: [`prisma/schema.prisma`](../prisma/schema.prisma).  
Must stay aligned with **oc4d-server**. This repo does not ship a full migration history.

Gaze **reads** these tables:

| Model | Used for | Important fields |
|-------|----------|------------------|
| `Module` | Catalog + timer matching | `name`, `index_html_url` (slug source), `enabled` |
| `Category` | Grouping / stats | `name`, `logo_url`, `enabled` — **no `description` column** (do not add one) |
| `User` | Display names | `email` (match log identity), `full_name` exposed in Prisma as `name` |

Also in schema but **unused by Gaze UI:** `Report`, `TrainingVideos`.

#### Recent schema change

| Before | After |
|--------|--------|
| Gaze-owned table `modulegaze_user_pool` | Shared oc4d `User` table |

Cleanup (run once if the old table still exists):

```sql
-- prisma/drop_modulegaze_user_pool.sql
DROP TABLE IF EXISTS "modulegaze_user_pool";
```

`lib/userPoolCache.ts` maps `email → display name` and can tolerate `name` vs `full_name` column drift.

### Live sessions (memory only)

Not stored in Postgres. Keyed by **`(ip, username)`** — not IP alone.

| Field | Meaning |
|-------|---------|
| `ip` | Client IP (`::ffff:` stripped) |
| `username` | Email / login, or `Guest` |
| `module` | Stable slug (e.g. `cdn_math`) |
| `startTimeMs` / `lastActivityMs` | Start and last journal/heartbeat activity |

| Rule | Detail |
|------|--------|
| Idle timeout | 5 minutes (`SESSION_INACTIVITY_MS`) |
| Guest → login | Same IP gets a real user → Guest row is ended (no duplicate row) |
| Loopback | `127.0.0.1` / `::1` ignored unless `MODULEGAZE_INCLUDE_LOOPBACK=1` |
| Live duration | Seconds since `startTime` while the row is shown |
| Ended duration | **Idle cleanup** ends at `lastActivityMs` (avoids +5 min inflate). **`close` heartbeat** and **module switch** end at `Date.now()` |
| Persist filter | Durations of `0` seconds are not written to disk |

### Session log file (disk)

Directory: `MODULEFETCH_LOG_DIR` (default `/var/log/modulegaze`).  
Line format (`schemaVersion=1`), tab-separated:

```text
2026-05-04T12:00:00.000Z	userId=teacher@example.com|192.168.1.20	moduleId=cdn_math	durationSeconds=305	schemaVersion=1
```

| File | Contents |
|------|----------|
| `modulegaze-sessions.log` | Ended sessions |
| `modulegaze-access.log` | `{ISO}\t{journal line}` for module paths (only if `MODULEGAZE_TEE_ACCESS_LOG=1`) |
| `modulegaze-*-YYYY-MM-DD.log.zip` | Previous day, zipped on first write of a new day (collision suffix `-<timestamp>` possible) |
| Retention | Archives older than ~365 days; purge via API or throttled on ingest |

### Module slugs (from URLs)

| URL | Slug |
|-----|------|
| `/modules/cdn_math/...` | `cdn_math` |
| `/modules/<buildId>/cdn_math/...` | `cdn_math` |
| `/uploads/modules/<buildId>/cdn_math/...` | `cdn_math` |

Build ids look like `1763387547577_khemf99ie`. Always use the **first** stable segment — never later folders like `img` or `asset` (those caused phantom modules in older builds).

---

## 3. API contracts

Base: `http://<host>:3002`

| Method | Path | Auth | What it does |
|--------|------|------|--------------|
| `GET` | `/api/live-sessions` | — | Live session list from background monitor |
| `POST` | `/api/module-heartbeat` | — (CORS `*`) | Browser `ping` / `close` |
| `GET` | `/api/logs/stream` | — (CORS `*`) | SSE of module journal lines |
| `GET` | `/api/stats` | — | Module/category counts + feature flags |
| `GET` | `/api/user-pool` | — | `{ map: { email: displayName } }` |
| `GET` | `/api/modules` | — | DB + disk catalog + diagnostics |
| `POST` | `/api/modulefetch/ingest` | optional secret | Append one session log line |
| `POST` | `/api/modulefetch/purge` | optional secret | Delete archives older than ~1 year |

**Optional auth** for ingest/purge: set `MODULEFETCH_INGEST_SECRET`, then send `x-modulefetch-secret: <secret>` or `Authorization: Bearer <secret>`. If unset, those routes are open.

### `GET /api/live-sessions`

```json
{
  "enabled": true,
  "sessions": [
    {
      "ip": "192.168.1.20",
      "username": "teacher@example.com",
      "displayName": "Ada Teacher",
      "module": "cdn_math",
      "startTime": "2026-05-04T12:00:00.000Z",
      "lastActivity": "2026-05-04T12:04:30.000Z",
      "duration": 305
    }
  ]
}
```

`sessions` is `[]` when the monitor env flag is off.

### `POST /api/module-heartbeat`

Query only (no body):

| Param | Required | Values |
|-------|----------|--------|
| `slug` | yes | Module slug |
| `event` | yes | `ping` or `close` |
| `user` | no | Identity; default `Guest` |

| Status | Meaning |
|--------|---------|
| `204` | OK — also returned when silently ignored (monitor off, no IP, loopback filtered) |
| `400` | Bad `slug` / `event` |

```bash
curl -X POST "http://127.0.0.1:3002/api/module-heartbeat?slug=cdn_math&event=ping&user=teacher@example.com"
```

This repo only exposes the endpoint. A small script on **oc4d-served** module pages is expected to call it (`ping` / `close`); that injection lives in oc4d-server, not here.

### `GET /api/logs/stream`

SSE. Data events: `{"line":"...","timestamp":"..."}` (module paths only).  
May emit `event: log-source` with `available: false` on Windows / when journal is unavailable.

### `GET /api/stats`

```json
{
  "totalModules": 42,
  "totalCategories": 8,
  "uniqueUsersToday": 0,
  "activeSessions": 0,
  "modulefetchPeriodicFlushMinutes": 5,
  "backgroundModuleMonitor": true
}
```

`uniqueUsersToday` / `activeSessions` are always `0` from the API; the UI overwrites them from the **current** live session list (not a historical “users today” counter).

### `GET /api/user-pool`

`?refresh=1` forces a DB reload.

```json
{ "map": { "teacher@example.com": "Ada Teacher" } }
```

### `GET /api/modules`

Returns `modules` plus `sources` (DB ok/count, scan root/count) and `warnings`.  
Use this after deploy to confirm the uploads path is correct.

### `POST /api/modulefetch/ingest`

```json
{
  "userId": "teacher@example.com|192.168.1.20",
  "moduleId": "cdn_math",
  "durationSeconds": 305,
  "recordedAt": "2026-05-04T12:05:00.000Z"
}
```

Success: `{ "ok": true, "filename": "..." }` · Errors: `401` / `400` / `500`

### `POST /api/modulefetch/purge`

Success: `{ "ok": true, "removed": 3 }`

---

## 4. Run it (local & production)

There is **no** Dockerfile, Terraform, or CI config in this repo. Automation is `install.sh` + systemd.

| File | Role |
|------|------|
| [`install.sh`](../install.sh) | Bun, `bun install`, build, install unit, **restart** |
| [`cdnmodulegaze.service`](../cdnmodulegaze.service) | Production process + env |
| [`update.sh`](../update.sh) | Empty stub — use `git pull` + `./install.sh` |

### Local (developer machine)

```bash
git clone https://github.com/ComDevNet/cdn-module-gaze.git
cd cdn-module-gaze
bun install
```

Put DB URLs in `.env` (do not commit):

```bash
DATABASE_URL=postgresql://USER:PASS@HOST:PORT/oc4d
DIRECT_URL=postgresql://USER:PASS@HOST:PORT/oc4d
MODULEGAZE_INCLUDE_LOOPBACK=1   # only if testing heartbeats via localhost
```

```bash
bun run dev                         # Next dev port
# or
bun run build && bun run start      # port 3002
```

On Windows you will not get real `journalctl` sessions; use a Pi/Linux host for that, or test heartbeats locally.

### Production (Raspberry Pi)

Expected layout:

| Path | Role |
|------|------|
| `/home/pi/cdn-module-gaze` | App directory |
| `/home/pi/.bun/bin/bun` | Runtime in the unit file |
| `/home/pi/oc4d-server/workspaces/website/uploads/modules` | Module files on disk |
| `/var/log/modulegaze` | Gaze logs |

`DATABASE_URL` / `DIRECT_URL` are **not** in the systemd unit — provide them via `.env` in the app directory (Next loads it) or a systemd drop-in.

```bash
ssh pi@cdn.local
cd /home/pi/cdn-module-gaze          # or clone first
chmod +x install.sh && ./install.sh
```

`install.sh` installs Bun, builds, copies the unit, then `enable` + **`restart`**.

Verify:

```bash
sudo systemctl status cdnmodulegaze --no-pager
curl -s http://127.0.0.1:3002/api/live-sessions
curl -s http://127.0.0.1:3002/api/modules
sudo systemctl show cdnmodulegaze -p Environment
sudo ls -lah /var/log/modulegaze
```

Open `http://oc4d.cdn:3002`.

Purge old zip archives (optional cron):

```bash
curl -X POST http://127.0.0.1:3002/api/modulefetch/purge
# add -H "x-modulefetch-secret: …" if MODULEFETCH_INGEST_SECRET is set
```

---

## 5. Env vars

Set monitor/log paths in `cdnmodulegaze.service`. Set DB URLs in `.env` (or a drop-in).

| Variable | Pi default | Purpose |
|----------|------------|---------|
| `DATABASE_URL` / `DIRECT_URL` | (from `.env`) | Shared oc4d Postgres |
| `MODULEGAZE_BACKGROUND_MONITOR` | `1` | Server-side journal + sessions |
| `MODULEGAZE_TEE_ACCESS_LOG` | `1` | Write `modulegaze-access.log` |
| `MODULEGAZE_JOURNAL_SINCE` | `today` | `journalctl --since`; use `all` / `none` / `disable` to omit `--since` |
| `MODULEFETCH_LOG_DIR` | `/var/log/modulegaze` | Log directory |
| `MODULEFETCH_PERIODIC_FLUSH_MINUTES` | `5` | Browser/SSE periodic ingest only |
| `MODULEGAZE_UPLOADS_MODULES_ROOT` | `/home/pi/oc4d-server/.../uploads/modules` | Disk catalog scan |
| `MODULEFETCH_INGEST_SECRET` | unset | Lock down ingest/purge |
| `MODULEGAZE_INCLUDE_LOOPBACK` | unset | Allow `127.0.0.1` sessions when `1` |

---

## 6. Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Live table empty | `curl /api/live-sessions` — is `enabled` true? Is anyone actually hitting modules? Wrong uploads path will not empty sessions, but no journal identity will. |
| Monitor “on” but no journal sessions on Windows | Expected — no `journalctl`. |
| Everyone shows as Guest | oc4d logs need `user=…` (or heartbeat `user=`). Display names need rows in `User`. |
| Names like `img` / `asset` as modules | Old slug bug; current code takes the **first** stable segment. |
| Ingest returns `401` | Secret is set on the server; client must send the same header. |
| `/api/modules` scan count `0` | Fix `MODULEGAZE_UPLOADS_MODULES_ROOT` (often `/home/pi/...` vs `/oc4d-server/...`). |
| Env change ignored | `sudo systemctl daemon-reload && sudo systemctl restart cdnmodulegaze` |

---

## 7. Code map

| Concern | Where to look |
|---------|----------------|
| Startup / monitor on | `instrumentation.ts`, `lib/serverBackgroundModuleMonitor.ts` |
| Journal follow | `lib/oc4dJournalHub.ts` |
| Parse IP / user / module | `lib/oc4dLogLine.ts`, `lib/modulePath.ts` |
| Session store | `lib/serverBackgroundSessions.ts` |
| Display names | `lib/userPoolCache.ts` |
| Log files + zip + purge | `lib/moduleFetchStore.ts`, `lib/dailyLogArchive.ts` |
| Disk catalog | `lib/scanUploadsModules.ts` |
| HTTP routes | `app/api/**/route.ts` |
| Schema | `prisma/schema.prisma` |
| Deploy | `install.sh`, `cdnmodulegaze.service` |

---

*Optional topic pages under [`docs/`](README.md) expand individual sections; if anything conflicts, this file wins.*
