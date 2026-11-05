# Database

Module Gaze does **not** own a separate application database. Prisma models mirror tables in the **oc4d-server PostgreSQL** database (`DATABASE_URL` / `DIRECT_URL`).

Schema file: [`prisma/schema.prisma`](../prisma/schema.prisma).

There is no versioned Prisma migration history in this repo (only `prisma/migrations/migration_lock.toml`). Schema changes must stay aligned with oc4d-server.

## Models used by Gaze

### `Module`

Catalog rows for the module list and timer matching.

| Field | DB column | Notes |
|-------|-----------|--------|
| `id` | `id` | UUID |
| `name` | `name` | Unique display name |
| `description` | `description` | |
| `indexHtmlUrl` | `index_html_url` | Source of URL slug for matching |
| `logoUrl` | `logo_url` | |
| `language` | `language` | |
| `enabled` | `enabled` | Stats count enabled only |
| `open` | `open` | |
| `categories` | M2M | |

### `Category`

| Field | Notes |
|-------|--------|
| `id`, `name`, `logoUrl`, `enabled` | |
| — | **No `description` column** — oc4d-server does not have one; do not add it here |

API responses still expose `categories[].description: ""` for frontend compatibility.

### `User`

Identity display for the live-sessions panel.

| Prisma field | DB column | Role |
|--------------|-----------|------|
| `id` | `id` | |
| `name` | `full_name` | Shown in UI (`displayName`) |
| `email` | `email` | Unique; matched case-insensitively to log / heartbeat identity |

Mapped with `@@map("User")`.

`lib/userPoolCache.ts` introspects whether the display column is `name` or `full_name` and falls back to raw SQL when needed, for deployments with slight schema drift.

## Models present but unused by Gaze UI

- **`Report`** — composite PK `(orgName, date)`
- **`TrainingVideos`** — video metadata

Left in schema for Prisma Studio / shared-DB completeness; Gaze does not query them.

## Structural change: user pool table removed

Older builds used a Gaze-owned table `modulegaze_user_pool`. That was replaced by the shared **`User`** model.

One-off cleanup (run once against the same DB if the old table exists):

```sql
-- prisma/drop_modulegaze_user_pool.sql
DROP TABLE IF EXISTS "modulegaze_user_pool";
```

## Env

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Prisma connection (pooled or standard) |
| `DIRECT_URL` | Direct URL for Prisma (migrations / generate) |
