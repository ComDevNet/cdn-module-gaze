import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import {
  getModuleFetchDir,
  MODULEGAZE_SESSION_LOG_NAME,
} from "@/lib/moduleFetchPaths";
import { appendLineWithDailyZip } from "@/lib/dailyLogArchive";

/**
 * This directory holds:
 * - `modulegaze-sessions.log` (active day) + daily `.zip` archives of prior days
 * - `modulegaze-access.log` (active day, optional tee) + daily `.zip` archives
 * - legacy `mf-*.tar.gz` files from earlier versions
 */
export {
  DEFAULT_MODULEFETCH_DIR,
  getModuleFetchDir,
  MODULEGAZE_ACCESS_LOG_NAME,
  MODULEGAZE_SESSION_LOG_NAME,
} from "@/lib/moduleFetchPaths";
export {
  appendModulegazeAccessLogLine,
  isAccessLogTeeEnabled,
} from "@/lib/moduleFetchAccessLog";

export interface ModuleFetchPayload {
  schemaVersion: 1;
  recordedAt: string;
  userId: string;
  moduleId: string;
  durationSeconds: number;
}

const ZIP_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

let lastPurgeTime = 0;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export async function ensureModuleFetchDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function isModuleFetchArchive(name: string): boolean {
  if (name.startsWith("mf-")) {
    return name.endsWith(".tar.gz") || name.endsWith(".zip");
  }
  if (
    /^modulegaze-(?:access|sessions)-\d{4}-\d{2}-\d{2}(?:-\d+)?\.log(?:\.zip)?$/.test(
      name
    )
  ) {
    return true;
  }
  return false;
}

/** Deletes old archived log artifacts in `dir` older than one year. */
export async function purgeOldModuleFetchArchives(dir: string): Promise<number> {
  const now = Date.now();
  let removed = 0;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !isModuleFetchArchive(ent.name)) continue;
    const full = path.join(dir, ent.name);
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }
    if (now - st.mtimeMs > ZIP_RETENTION_MS) {
      try {
        await fs.unlink(full);
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

/** Throttled purge so routine ingests do not scan the directory every time. */
export async function maybePurgeOldArchives(dir: string): Promise<void> {
  const t = Date.now();
  if (t - lastPurgeTime < PURGE_INTERVAL_MS) return;
  lastPurgeTime = t;
  await purgeOldModuleFetchArchives(dir);
}

function sanitizeLogField(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").trim();
}

function formatSessionLogLine(payload: ModuleFetchPayload): string {
  return [
    payload.recordedAt,
    `userId=${sanitizeLogField(payload.userId)}`,
    `moduleId=${sanitizeLogField(payload.moduleId)}`,
    `durationSeconds=${Math.max(0, Math.round(payload.durationSeconds))}`,
    `schemaVersion=${payload.schemaVersion}`,
  ].join("\t");
}

/** Server-side ingest (same storage path as POST /api/modulefetch/ingest). */
export async function persistModuleFetchRecord(
  payload: Omit<ModuleFetchPayload, "schemaVersion" | "recordedAt"> & {
    recordedAt?: string;
  }
): Promise<{ filename: string }> {
  const fullPayload: ModuleFetchPayload = {
    schemaVersion: 1,
    recordedAt: payload.recordedAt ?? new Date().toISOString(),
    userId: payload.userId,
    moduleId: payload.moduleId,
    durationSeconds: Math.round(Number(payload.durationSeconds)),
  };
  const dir = getModuleFetchDir();
  await ensureModuleFetchDir(dir);
  const out = await appendLineWithDailyZip(
    dir,
    MODULEGAZE_SESSION_LOG_NAME,
    formatSessionLogLine(fullPayload)
  );
  void maybePurgeOldArchives(dir).catch((e) =>
    console.error("[modulefetch] retention purge failed:", e)
  );
  return out;
}
