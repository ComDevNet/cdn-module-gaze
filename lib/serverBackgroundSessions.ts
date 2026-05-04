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

let rows: Row[] = [];

function userIdFor(row: Row): string {
  return `${row.username}|${row.ip}`;
}

function persistEndedSessionRow(row: Row, endedAtMs: number): void {
  const durationSeconds = Math.max(0, Math.floor((endedAtMs - row.startTimeMs) / 1000));
  void import(
    /* webpackIgnore: true */
    "./moduleFetchStore"
  )
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

function updateOrInsertSession(ip: string, username: string, module: string): void {
  const now = Date.now();
  const idx = rows.findIndex((r) => r.ip === ip && r.username === username);
  if (idx >= 0) {
    const existing = rows[idx];
    if (!existing) return;
    if (existing.module !== module) {
      // Keep per-user module history when they navigate between modules.
      persistEndedSessionRow(existing, now);
      rows[idx] = {
        ip,
        username,
        module,
        startTimeMs: now,
        lastActivityMs: now,
      };
    } else {
      rows[idx] = { ...existing, lastActivityMs: now };
    }
    return;
  }
  rows.push({
    ip,
    username,
    module,
    startTimeMs: now,
    lastActivityMs: now,
  });
}

function touchSession(ip: string, username: string, moduleSlug: string): void {
  const now = Date.now();
  const idx = rows.findIndex(
    (r) =>
      r.ip === ip &&
      r.username === username &&
      r.module === moduleSlug
  );
  if (idx < 0) return;
  const r = rows[idx];
  if (!r) return;
  rows[idx] = { ...r, lastActivityMs: now };
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
  for (const r of rows) {
    if (r.lastActivityMs <= staleBefore) {
      removed.push(r);
    } else {
      kept.push(r);
    }
  }
  rows = kept;
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
  return rows.map((r) => ({
    ip: r.ip,
    username: r.username,
    displayName: resolveDisplayNameFromCache(r.username),
    module: r.module,
    startTime: new Date(r.startTimeMs).toISOString(),
    lastActivity: new Date(r.lastActivityMs).toISOString(),
    duration: Math.floor((now - r.startTimeMs) / 1000),
  }));
}
