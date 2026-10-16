# Logging and Retention

Default directory: `/var/log/modulegaze` (`MODULEFETCH_LOG_DIR`).

## Files

| File | Contents | When written |
|------|----------|--------------|
| `modulegaze-access.log` | Module-related oc4d journal lines | `MODULEGAZE_TEE_ACCESS_LOG=1` |
| `modulegaze-sessions.log` | Ended session duration records | Background persist, ingest API, browser flush |

## Session line schema (`schemaVersion=1`)

Tab-separated:

```text
{ISO8601}	userId={username}|{ip}	moduleId={slug}	durationSeconds={n}	schemaVersion=1
```

Example:

```text
2026-05-04T12:00:00.000Z	userId=teacher@example.com|192.168.1.20	moduleId=cdn_math	durationSeconds=305	schemaVersion=1
```

Fields are sanitized (newlines/tabs stripped). Zero-duration rows are not written from the background monitor.

## Daily zip rotation

On the first write of a new calendar day, yesterday’s live `.log` is zipped to:

- `modulegaze-access-YYYY-MM-DD.log.zip`
- `modulegaze-sessions-YYYY-MM-DD.log.zip`

Implementation: `lib/dailyLogArchive.ts` via `appendLineWithDailyZip`.

## Retention

- Archives older than **365 days** are eligible for deletion
- `POST /api/modulefetch/purge` — explicit purge (cron-friendly)
- Ingest path also runs a **throttled** purge at most once per hour
- Legacy `mf-*.tar.gz` / `mf-*.zip` names are still recognized as archives

## Writers

| Path | Mechanism |
|------|-----------|
| Background monitor session end | `persistModuleFetchRecord` from `serverBackgroundSessions` |
| UI / SSE mode flush | `POST /api/modulefetch/ingest` (`lib/postModulefetchIngest.ts`) |
| Periodic UI flush | Driven by `MODULEFETCH_PERIODIC_FLUSH_MINUTES` from `/api/stats` (SSE / browser monitoring path) |
