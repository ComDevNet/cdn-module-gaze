# Module Catalog

`GET /api/modules` merges two sources into one sorted list.

## Database source

Prisma `Module` rows with related `Category.name` values. Categories are mapped with empty `description` strings for API compatibility (oc4d has no category description column).

## Disk scan source

When `MODULEGAZE_UPLOADS_MODULES_ROOT` is set (or defaults are tried), `lib/scanUploadsModules.ts` walks:

```text
<uploads/modules>/<buildId>/<slug>/...index.html
```

Discovered slugs that are **not** already present in the DB (by slug from `indexHtmlUrl`) are appended as extra catalog rows so timers and search still work for modules present on disk but not yet registered.

Default roots if env unset:

1. `/oc4d-server/workspaces/website/uploads/modules`
2. `/var/www/oc4d.cdn/uploads/modules`

Production systemd unit sets:

```text
MODULEGAZE_UPLOADS_MODULES_ROOT=/home/pi/oc4d-server/workspaces/website/uploads/modules
```

## Diagnostics payload

The `sources` and `warnings` fields exist so operators can verify deploy paths without reading server logs:

- `database.ok` / `database.error` — Prisma connectivity
- `scan.root` / `scan.rootsTried` / `scan.count` — which directories were probed
- Warnings when DB fails, configured root finds nothing, or merge is empty

## Timer matching

UI time limits are configured by database module name. At runtime, the live session’s slug is matched to each module’s `indexHtmlUrl` via `extractModuleIdFromPath` (see [Log Parsing](Log-Parsing.md)).
