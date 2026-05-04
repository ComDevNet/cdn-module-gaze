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

function updateOrInsertSession(
  ip: string,
  username: string,
  module: string
): void {
  const now = Date.now();
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

  // No session for this exact `(ip, user, module)`. Two scenarios:
  //
  //   a) Cold start: monitor is just coming up and the user was already
  //      reading a module before we attached. There is NO active session
  //      for this user yet → seed one from this heartbeat so they show up.
  //
  //   b) Unrelated asset: user is viewing module X, and their browser is
  //      pulling a thumbnail or preview from module Y under
  //      `/uploads/modules/<buildId>/Y/...`. Y matches the asset-slug
  //      regex even though the user never navigated to Y. We must NOT
  //      seed a session for Y — doing so would persist X with ~0
  //      duration and replace it with Y, which then thrashes again on
  //      the next thumbnail. (This was the bug behind dozens of
  //      `durationSeconds=0` records in modulegaze-sessions.log.)
  //
  // Distinguish the two by whether the user already has any session.
  const userHasActiveSession = state.rows.some(
    (r) => r.ip === ip && r.username === username
  );
  if (userHasActiveSession) return;
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
  for (const r of removed) {
    persistEndedSessionRow(r, Date.now());
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
  const now = Date.now();
  return state.rows.map((r) => ({
    ip: r.ip,
    username: r.username,
    displayName: resolveDisplayNameFromCache(r.username),
    module: r.module,
    startTime: new Date(r.startTimeMs).toISOString(),
    lastActivity: new Date(r.lastActivityMs).toISOString(),
    duration: Math.floor((now - r.startTimeMs) / 1000),
  }));
}
