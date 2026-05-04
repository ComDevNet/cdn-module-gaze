import { SESSION_INACTIVITY_MS } from "@/lib/sessionConstants";
import {
  parseOc4dModuleAccessLine,
  parseOc4dModuleAssetHeartbeat,
} from "@/lib/oc4dLogLine";
import { resolveDisplayNameFromCache } from "@/lib/userPoolCache";

type Row = {
  ip: string;
  username: string;
  module: string;
  startTimeMs: number;
  lastActivityMs: number;
};

/**
 * Shared in-memory state.
 *
 * Next.js bundles `instrumentation.ts` (where the journal hub feeds lines
 * into `processBackgroundJournalLine`) and the route handlers (where
 * `getLiveSessionsSnapshot` is read by `GET /api/live-sessions`) into
 * separate chunks. With module-scoped `let rows`, each bundle gets its own
 * copy and the API never sees what the monitor wrote — the dashboard's
 * "User & module time tracking" panel stayed empty no matter what oc4d
 * logged. Pinning the array to `globalThis` makes both bundles share the
 * same instance (same trick used by `lib/prisma.ts`).
 */
const SESSIONS_STATE_KEY = Symbol.for("cdnModuleGaze.backgroundSessions.state");
type SessionsState = { rows: Row[] };
const globalForSessions = globalThis as unknown as {
  [SESSIONS_STATE_KEY]?: SessionsState;
};
const state: SessionsState =
  globalForSessions[SESSIONS_STATE_KEY] ?? { rows: [] };
globalForSessions[SESSIONS_STATE_KEY] = state;

function userIdFor(row: Row): string {
  return `${row.username}|${row.ip}`;
}

function persistEndedSessionRow(row: Row, endedAtMs: number): void {
  const durationSeconds = Math.max(
    0,
    Math.floor((endedAtMs - row.startTimeMs) / 1000)
  );
  // 0-second records are meaningless — they happen when a module is
  // replaced within sub-second of being seeded (e.g. legacy heartbeat
  // thrashing). Don't pollute modulegaze-sessions.log with them.
  if (durationSeconds === 0) return;
  // Plain dynamic import (no `webpackIgnore`): let webpack create a real
  // chunk so the runtime path resolves under `.next/server/chunks/...`.
  // With `webpackIgnore: true` the literal "./moduleFetchStore" string
  // survives into the compiled chunk and bun fails to resolve it.
  void import("./moduleFetchStore")
    .then(({ persistModuleFetchRecord }) =>
      persistModuleFetchRecord({
        userId: userIdFor(row),
        moduleId: row.module,
        durationSeconds,
        recordedAt: new Date(endedAtMs).toISOString(),
      })
    )
    .catch((e) =>
      console.error("[serverBackgroundSessions] persist failed:", e)
    );
}

/**
 * When a logged-in user appears at an IP that still has a `Guest` session,
 * collapse the Guest into the logged-in identity. Without this, the same
 * browser shows up twice in the live-sessions panel (once as Guest, once
 * as the real name) until the stale Guest row ages out 5 minutes later.
 *
 * Heuristic is simple: same IP, Guest username, any module. On a typical
 * LAN deployment each device gets its own IP so this is the right call;
 * if multi-user-per-IP behind NAT becomes common we can tighten to a
 * recency window.
 */
function endGuestRowForIpIfPresent(ip: string, atMs: number): void {
  const guestIdx = state.rows.findIndex(
    (r) => r.ip === ip && r.username === "Guest"
  );
  if (guestIdx < 0) return;
  const guest = state.rows[guestIdx];
  if (guest) persistEndedSessionRow(guest, atMs);
  state.rows.splice(guestIdx, 1);
}

function updateOrInsertSession(
  ip: string,
  username: string,
  module: string
): void {
  const now = Date.now();

  // If a real user is showing up at this IP, retire any Guest row at the
  // same IP — they were almost certainly the same browser pre-signin.
  if (username !== "Guest") {
    endGuestRowForIpIfPresent(ip, now);
  }

  const idx = state.rows.findIndex(
    (r) => r.ip === ip && r.username === username
  );
  if (idx >= 0) {
    const existing = state.rows[idx];
    if (!existing) return;
    if (existing.module !== module) {
      // Keep per-user module history when they navigate between modules.
      persistEndedSessionRow(existing, now);
      state.rows[idx] = {
        ip,
        username,
        module,
        startTimeMs: now,
        lastActivityMs: now,
      };
    } else {
      state.rows[idx] = { ...existing, lastActivityMs: now };
    }
    return;
  }
  state.rows.push({
    ip,
    username,
    module,
    startTimeMs: now,
    lastActivityMs: now,
  });
}

function touchSession(
  ip: string,
  username: string,
  moduleSlug: string
): void {
  const now = Date.now();
  const idx = state.rows.findIndex(
    (r) =>
      r.ip === ip && r.username === username && r.module === moduleSlug
  );
  if (idx >= 0) {
    const r = state.rows[idx];
    if (!r) return;
    state.rows[idx] = { ...r, lastActivityMs: now };
    return;
  }

  // No session for this exact `(ip, user, module)`. Three scenarios:
  //
  //   a) Cold start: monitor is just coming up and the user was already
  //      reading a module before we attached. There is no session for
  //      this user yet → seed one from this heartbeat so they show up.
  //
  //   b) Unrelated asset (thumbnail fanout): user is viewing module X,
  //      and their browser is pulling a thumbnail or preview from
  //      module Y under `/uploads/modules/<buildId>/Y/...`. Y matches
  //      the asset-slug regex even though the user never navigated to
  //      Y. Seeding a session for Y would persist X with ~0 duration
  //      and replace it with Y — that was the bug behind dozens of
  //      `durationSeconds=0` records in modulegaze-sessions.log.
  //
  //   c) Stale Guest log line after sign-in: a Guest hit that was
  //      issued before the user signed in arrives after their
  //      logged-in session has already taken over the IP. Re-creating
  //      a Guest row at that IP would bring the duplicate Guest +
  //      logged-in pair right back.
  //
  // For logged-in users we only need to guard against (b): scope the
  // "already active" check to the same username so a logged-in user
  // sharing an IP with someone else is still seedable.
  // For Guests we additionally guard against (c) by widening the
  // check to ANY username at this IP — late Guest log lines at an IP
  // owned by a logged-in user are dropped on the floor.
  const blocked = state.rows.some((r) =>
    username === "Guest"
      ? r.ip === ip
      : r.ip === ip && r.username === username
  );
  if (blocked) return;
  updateOrInsertSession(ip, username, moduleSlug);
}

export function processBackgroundJournalLine(line: string): void {
  const entry = parseOc4dModuleAccessLine(line);
  if (entry) {
    updateOrInsertSession(entry.ip, entry.username, entry.module);
    return;
  }
  const beat = parseOc4dModuleAssetHeartbeat(line);
  if (beat) {
    touchSession(beat.ip, beat.username, beat.module);
  }
}

/**
 * Public entry point for the browser-emitted heartbeat path
 * (`POST /api/module-heartbeat?event=ping`). Same semantics as the
 * journal-driven asset heartbeat — bumps `lastActivityMs` for an
 * exact-match session, ignores stale heartbeats for users already
 * tracked on a different module (thumbnail-thrash / cross-tab case),
 * and seeds a session at cold-start if no other session exists for
 * that browser/IP. Logged-in heartbeats also retire any Guest row at
 * the same IP via `updateOrInsertSession`'s sign-in promotion.
 */
export function recordModuleHeartbeat(
  ip: string,
  username: string,
  module: string
): void {
  touchSession(ip, username, module);
}

/**
 * Public entry point for explicit "user closed the tab / navigated
 * away" signals — the `pagehide` / `beforeunload` sendBeacon dispatched
 * by the heartbeat script injected into oc4d-served module pages.
 * Persists the session with the actual close timestamp (no 5-minute
 * idle-timeout overcount, no lastActivityMs undercount on static pages).
 */
export function endModuleSession(
  ip: string,
  username: string,
  module: string
): void {
  const idx = state.rows.findIndex(
    (r) =>
      r.ip === ip && r.username === username && r.module === module
  );
  if (idx < 0) return;
  const row = state.rows[idx];
  if (row) persistEndedSessionRow(row, Date.now());
  state.rows.splice(idx, 1);
}

export function runBackgroundSessionCleanup(): void {
  const staleBefore = Date.now() - SESSION_INACTIVITY_MS;
  const removed: Row[] = [];
  const kept: Row[] = [];
  for (const r of state.rows) {
    if (r.lastActivityMs <= staleBefore) {
      removed.push(r);
    } else {
      kept.push(r);
    }
  }
  // Mutate the shared array in place so any module instance that captured
  // a reference to `state.rows` keeps observing the latest contents.
  state.rows.length = 0;
  for (const r of kept) state.rows.push(r);
  // Use `lastActivityMs` (not `Date.now()`) as the end-of-session timestamp.
  // The 5-minute idle window between "user actually left" and "cleanup
  // fires" was previously inflating every closed-tab record by up to
  // SESSION_INACTIVITY_MS. With this change a session that was last
  // active at T ends with duration = T - startTimeMs, regardless of when
  // the cleanup sweep happens to fire. (Pure-static HTML pages will
  // undercount until Phase-2 browser heartbeats land — those bump
  // `lastActivityMs` every 30s while the tab is visible.)
  for (const r of removed) {
    persistEndedSessionRow(r, r.lastActivityMs);
  }
}

export type LiveSessionSnapshot = {
  ip: string;
  username: string;
  /** From `User.name` when `User.email` matches the log login (e.g. oc4d remote user). */
  displayName: string;
  module: string;
  startTime: string;
  lastActivity: string;
  duration: number;
};

export function getLiveSessionsSnapshot(): LiveSessionSnapshot[] {
  return state.rows.map((r) => ({
    ip: r.ip,
    username: r.username,
    displayName: resolveDisplayNameFromCache(r.username),
    module: r.module,
    startTime: new Date(r.startTimeMs).toISOString(),
    lastActivity: new Date(r.lastActivityMs).toISOString(),
    // Tracking time is bounded by the last signal we have for this user.
    // Using `now - startTimeMs` would keep ticking up after the user
    // closed their tab (we have no way to know they're gone until idle
    // timeout fires). Anchoring duration to `lastActivityMs` instead
    // freezes the counter at the last evidence of presence — accurate
    // for games/video/interactive modules that emit ongoing requests,
    // and conservative for static pages until Phase-2 heartbeats land.
    duration: Math.max(
      0,
      Math.floor((r.lastActivityMs - r.startTimeMs) / 1000)
    ),
  }));
}
