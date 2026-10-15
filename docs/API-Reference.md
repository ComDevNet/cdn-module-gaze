# API Reference

All routes live under `app/api/`. Most use `dynamic = "force-dynamic"` and the Node.js runtime where noted.

---

## `GET /api/live-sessions`

Live session snapshot from the background monitor store.

**Response**

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

- `enabled` — whether `MODULEGAZE_BACKGROUND_MONITOR` is on
- `sessions` — empty array when the monitor is off
- `duration` — whole seconds since `startTime` while the row is live
- `displayName` — from `User.name` when email matches; otherwise falls back to username

---

## `POST /api/module-heartbeat`

Browser-driven session lifecycle (injected into oc4d module pages). See [Heartbeat Integration](Heartbeat-Integration.md).

**Query params**

| Param | Required | Values |
|-------|----------|--------|
| `slug` | yes | Module slug |
| `event` | yes | `ping` \| `close` |
| `user` | no | Identity string (normalized; default `Guest`) |

**Headers:** client IP from `x-forwarded-for` (first hop) or `req.ip`.

**Responses**

| Status | When |
|--------|------|
| `204` | Success, or silently discarded (monitor off, missing IP, loopback without include flag) |
| `400` | Missing `slug` or `event` not `ping`/`close` |

**CORS:** `Access-Control-Allow-Origin: *` (module pages may be on `oc4d.cdn`, LAN IP, or hotspot IP). `OPTIONS` returns `204`.

No request body.

---

## `GET /api/logs/stream`

Server-Sent Events feed of module-related oc4d journal lines.

**Events**

- Default data: `{"line":"...","timestamp":"..."}` — filtered to lines mentioning `/modules/` or `/uploads/modules/`
- `event: log-source` — `{"available":false,"reason":"..."}` on Windows or when journal follow is unavailable
- Comment keepalives every ~25s when idle

**Env:** `MODULEGAZE_JOURNAL_SINCE`, `MODULEGAZE_TEE_ACCESS_LOG` (tee happens in the hub, not in the SSE payload).

**CORS:** `Access-Control-Allow-Origin: *`.

---

## `GET /api/stats`

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

- `uniqueUsersToday` / `activeSessions` are placeholders (`0`); the UI fills them from live sessions
- On DB error, counts return `0` without failing the app

---

## `GET /api/user-pool`

```
GET /api/user-pool
GET /api/user-pool?refresh=1
```

```json
{
  "map": {
    "teacher@example.com": "Ada Teacher"
  }
}
```

Keys are normalized emails. `refresh=1` forces a cache reload from the `User` table.

---

## `GET /api/modules`

Merged module catalog (database + optional disk scan).

```json
{
  "modules": [ /* ScannedModuleRow[] */ ],
  "sources": {
    "mergedCount": 40,
    "database": { "ok": true, "count": 38, "error": null },
    "scan": {
      "enabled": true,
      "root": "/home/pi/oc4d-server/workspaces/website/uploads/modules",
      "rootsTried": ["..."],
      "count": 12
    }
  },
  "warnings": []
}
```

Disk scan root: `MODULEGAZE_UPLOADS_MODULES_ROOT`, else tries:

1. `/oc4d-server/workspaces/website/uploads/modules`
2. `/var/www/oc4d.cdn/uploads/modules`

See [Module Catalog](Module-Catalog.md).

---

## `POST /api/modulefetch/ingest`

Append a session duration record to `modulegaze-sessions.log`.

**Body**

```json
{
  "userId": "teacher@example.com|192.168.1.20",
  "moduleId": "cdn_math",
  "durationSeconds": 305,
  "recordedAt": "2026-05-04T12:05:00.000Z"
}
```

`recordedAt` optional (defaults to now). `durationSeconds` must be a finite number ≥ 0.

**Auth (optional):** if `MODULEFETCH_INGEST_SECRET` is set, require header `x-modulefetch-secret: <secret>` or `Authorization: Bearer <secret>`. If unset, open.

**Success:** `{ "ok": true, "filename": "..." }`  
**Errors:** `401`, `400`, `500`

---

## `POST /api/modulefetch/purge`

Delete archived log artifacts older than ~365 days. Same auth as ingest.

**Success:** `{ "ok": true, "removed": 3 }`

Suitable for a low-traffic cron. Ingest also runs a throttled purge at most once per hour.
