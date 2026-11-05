# Log Parsing

Source: `journalctl -u oc4d.service` via `lib/oc4dJournalHub.ts`. Line parsing: `lib/oc4dLogLine.ts`. Path/slug rules: `lib/modulePath.ts`.

## Example journal line

```text
Jul 02 03:13:12 cdn oc4d[2369]: info: ::ffff:192.168.4.238 - [2024-07-02T03:13:12.202Z] "GET /modules/cdn_acid_bases_and_salts/content/index.html HTTP/1.1" 200
```

With morgan `user=` token (preferred identity):

```text
... "GET /uploads/modules/1763387547577_khemf99ie/cdn_verbs/content/index.html HTTP/1.1" 200 user=teacher@example.com
```

## Extraction

1. **IP** — strip `::ffff:` prefix from IPv4-mapped addresses
2. **Identity** — morgan `user=`, then other remote-user / header / query patterns; normalize; else Guest
3. **Module slug** — from request path (see below)
4. **Entry vs asset** — `index.html` (and equivalent entry paths) start/switch sessions; other GETs under the same module bump activity

Only lines containing `/modules/` or `/uploads/modules/` are forwarded on the SSE stream and considered for access-log tee.

## Module slug algorithm

Supported layouts:

| Path pattern | Slug |
|--------------|------|
| `/modules/<slug>/...` | `<slug>` |
| `/modules/<buildId>/<slug>/...` | `<slug>` (skip dynamic build segment) |
| `/uploads/modules/<buildId>/<slug>/...` | `<slug>` |

Dynamic build segments match `/^\d{10,}_[a-zA-Z0-9_-]+$/` (e.g. `1763387547577_khemf99ie`).

**Rule:** take the **first stable** (non-build) segment under the modules root. Downstream folders (`img`, `asset`, `content`, `style`, …) must never become `moduleId`. Earlier code used the last stable segment and produced phantom modules in `modulegaze-sessions.log`.

Candidate list is capped at the first two path segments under `/modules` or `/uploads/modules` so asset deep paths cannot pollute the slug.

## Matching timers to catalog

Dashboard timers use database module **names**, but log sessions use **URL slugs**. Matching compares the slug extracted from `Module.indexHtmlUrl` to the session’s `module` field.
