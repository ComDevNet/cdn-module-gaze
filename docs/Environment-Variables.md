# Environment Variables

## Required / database

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | Prisma datasource URL (shared oc4d Postgres) |
| `DIRECT_URL` | — | Prisma direct URL |
| `NODE_ENV` | `production` in service | Next.js mode |

## Monitoring and logs

| Variable | Service default | Purpose |
|----------|-----------------|---------|
| `MODULEGAZE_BACKGROUND_MONITOR` | `1` | Server-side journal follow + in-memory sessions |
| `MODULEGAZE_TEE_ACCESS_LOG` | `1` | Tee module journal lines to `modulegaze-access.log` |
| `MODULEGAZE_JOURNAL_SINCE` | `today` | Passed to `journalctl --since`. Use `all`, `none`, or `disable` to skip `--since` |
| `MODULEFETCH_LOG_DIR` | `/var/log/modulegaze` | Access + session log directory |
| `MODULEFETCH_PERIODIC_FLUSH_MINUTES` | `5` | UI periodic ingest while browser monitoring is active (`0` = off) |
| `MODULEFETCH_INGEST_SECRET` | unset | If set, ingest/purge require matching secret header |
| `MODULEGAZE_UPLOADS_MODULES_ROOT` | `/home/pi/oc4d-server/workspaces/website/uploads/modules` | Disk module scan root |
| `MODULEGAZE_INCLUDE_LOOPBACK` | unset | Set `1`/`true`/`yes` to track `127.0.0.1` / `::1` |

## Runtime (framework)

| Variable | Purpose |
|----------|---------|
| `NEXT_RUNTIME` | Instrumentation only runs when `nodejs` |

## Service file reference

See [`cdnmodulegaze.service`](../cdnmodulegaze.service) for the production unit environment block. Prefer editing the unit (or a drop-in) over scattering env files on the Pi.
