# Architecture

## Stack

| Layer | Choice |
|-------|--------|
| Runtime / package manager | Bun |
| Framework | Next.js 15.3 (App Router) |
| UI | React 19, Tailwind 4, shadcn/ui |
| ORM / DB | Prisma 6.11 → PostgreSQL (shared with oc4d) |
| Process manager | systemd (`cdnmodulegaze.service`) |

Entry points:

- `instrumentation.ts` — on Node runtime: refresh user-pool cache; enable background module monitor
- `bun run start` → `next start -p 3002`
- UI: `app/page.tsx`

## Dual monitoring modes

### 1. Background monitor (production default)

Enabled when `MODULEGAZE_BACKGROUND_MONITOR=1` (set in `cdnmodulegaze.service`).

On Next.js Node startup, `instrumentation.ts` calls `enableBackgroundModuleMonitor()`, which:

1. Subscribes to the shared **oc4d journal hub** (`lib/oc4dJournalHub.ts`)
2. Parses each line into IP / identity / module (`lib/oc4dLogLine.ts`)
3. Updates the in-memory session store (`lib/serverBackgroundSessions.ts`)
4. Optionally tees module-related lines to `modulegaze-access.log`
5. Persists ended sessions to `modulegaze-sessions.log`

The dashboard polls **`GET /api/live-sessions`**. “Start Monitoring” becomes Pause/Resume for the live view; **tracking does not require an open browser**.

Skipped on `win32` (no `journalctl`).

### 2. Browser SSE mode (legacy / fallback)

UI connects to **`GET /api/logs/stream`** (Server-Sent Events), parses lines client-side, and may flush sessions via **`POST /api/modulefetch/ingest`** (including periodic flush when `MODULEFETCH_PERIODIC_FLUSH_MINUTES` > 0).

Use this when the background monitor is off, or for debugging the raw journal feed.

## Shared state across Next.js chunks

Next.js can load API routes and instrumentation in separate bundle chunks. The journal hub and session store are pinned on `globalThis` via `Symbol.for(...)` so the live-sessions panel and heartbeat route always see the same rows. If that pinning regresses, the UI shows an empty live panel while the monitor is “running.”

## Data flow (production)

```
┌──────────────────┐     journalctl -f      ┌─────────────────────┐
│  oc4d.service    │ ─────────────────────▶ │  oc4dJournalHub     │
└──────────────────┘                        │  (single follower)  │
                                            └──────────┬──────────┘
                                                       │
         ┌─────────────────────────────────────────────┼─────────────────┐
         ▼                                             ▼                 ▼
┌─────────────────┐                         ┌──────────────────┐  access tee
│ SSE subscribers │                         │ session store    │  (optional)
│ /api/logs/stream│                         │ (ip, username)   │
└─────────────────┘                         └────────┬─────────┘
                                                     │
┌─────────────────┐     POST ping/close              │ idle / switch / close
│ module pages    │ ───────────────────────────────▶ │
│ (oc4d inject)   │     /api/module-heartbeat        ▼
└─────────────────┘                         modulegaze-sessions.log
                                                     │
                                            GET /api/live-sessions
                                                     ▼
                                              Admin UI :3002
```

## Key libraries

| File | Role |
|------|------|
| `lib/oc4dJournalHub.ts` | One `journalctl` process; fan-out to SSE + internal handlers |
| `lib/oc4dLogLine.ts` | Parse morgan / access lines; normalize identity; loopback filter |
| `lib/modulePath.ts` | Slug extraction from `/modules/...` and `/uploads/modules/...` |
| `lib/serverBackgroundSessions.ts` | In-memory rows, Guest collapse, duration, persist |
| `lib/serverBackgroundModuleMonitor.ts` | Env gate + start journal follow + cleanup timer |
| `lib/userPoolCache.ts` | Email → display name from `User` table |
| `lib/moduleFetchStore.ts` | Session log write + daily zip + retention purge |
| `lib/scanUploadsModules.ts` | Disk catalog under uploads root |
