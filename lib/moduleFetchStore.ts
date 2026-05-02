import fs from "fs/promises";
import type { Dirent } from "fs";
import { createWriteStream } from "fs";
import path from "path";
import archiver from "archiver";
import { getModuleFetchDir } from "@/lib/moduleFetchPaths";

/**
 * This directory holds:
 * - `mf-*.tar.gz` — written only when the browser POSTs `/api/modulefetch/ingest`
 *   (session removed after inactivity, or when you click Stop monitoring). Not a
 *   mirror of nginx/journald.
 * - `modulegaze-access.log` — optional tee via `lib/moduleFetchAccessLog.ts` when
 *   `MODULEGAZE_TEE_ACCESS_LOG=1`.
 */
export {
  DEFAULT_MODULEFETCH_DIR,
  getModuleFetchDir,
  MODULEGAZE_ACCESS_LOG_NAME,
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
  if (!name.startsWith("mf-")) return false;
  return name.endsWith(".tar.gz") || name.endsWith(".zip");
}

/** Deletes `mf-*.tar.gz` (and legacy `mf-*.zip`) in `dir` older than one year. */
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

function sanitizeFilePart(s: string, maxLen: number): string {
  const out = s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, maxLen);
  return out.length > 0 ? out : "anon";
}

/**
 * Writes one `.tar.gz` per ingest: gzip-compressed tar with `modulefetch.json` at the
 * archive root (same logical layout as the former zip; path for downstream tools).
 */
export async function writeModuleFetchSessionTarGz(
  dir: string,
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

  const json = JSON.stringify(fullPayload, null, 2);
  const stamp = fullPayload.recordedAt.replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 10);
  const filename = `mf-${sanitizeFilePart(stamp, 48)}-${rand}.tar.gz`;
  const outPath = path.join(dir, filename);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("tar", {
      gzip: true,
      gzipOptions: { level: 9 },
    });
    archive.on("error", reject);
    output.on("error", reject);
    output.on("close", () => resolve());
    archive.pipe(output);
    archive.append(json, { name: "modulefetch.json" });
    void archive.finalize().catch(reject);
  });

  return { filename };
}

/** Server-side ingest (same files as POST /api/modulefetch/ingest). */
export async function persistModuleFetchRecord(
  payload: Omit<ModuleFetchPayload, "schemaVersion" | "recordedAt"> & {
    recordedAt?: string;
  }
): Promise<{ filename: string }> {
  const dir = getModuleFetchDir();
  await ensureModuleFetchDir(dir);
  const out = await writeModuleFetchSessionTarGz(dir, payload);
  void maybePurgeOldArchives(dir).catch((e) =>
    console.error("[modulefetch] retention purge failed:", e)
  );
  return out;
}
