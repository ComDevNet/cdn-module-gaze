# Local Development

## Prerequisites

- Bun
- Node-compatible tooling for Next.js / Prisma
- Access to a Postgres instance with oc4d schema (or a local mirror)

```bash
bun install
# configure DATABASE_URL and DIRECT_URL (e.g. in .env — do not commit secrets)
bun run dev
```

UI defaults to Next’s dev port unless you use `bun run start` (port **3002**).

## Windows limitations

- No `journalctl` → background module monitor is **skipped**
- `/api/logs/stream` reports log source unavailable / idle
- Session tracking from real oc4d traffic requires a Linux host (or Pi) with the service running

## Useful local env

```bash
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
MODULEGAZE_INCLUDE_LOOPBACK=1   # track 127.0.0.1 when testing heartbeats locally
# MODULEGAZE_BACKGROUND_MONITOR=1  # only useful where journalctl exists
```

## Tests

Unit tests live beside libraries as `lib/*.test.ts` (Node test runner style). There is currently **no** `npm`/`bun` `test` script in `package.json`; run the test files with your Node/Bun test runner as needed.

Key coverage areas: `modulePath`, `oc4dLogLine`, `serverBackgroundSessions`.

## Build

```bash
bun run build   # prisma generate && next build
bun run start   # next start -p 3002
```

## Schema alignment

Do not invent columns that oc4d-server lacks (notably `Category.description`). Prefer matching oc4d’s Prisma/SQL. See [Database](Database.md).
