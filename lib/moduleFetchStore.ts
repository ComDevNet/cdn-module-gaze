import fs from "fs/promises";
import type { Dirent } from "fs";
import { createWriteStream } from "fs";
import path from "path";
import archiver from "archiver";

/** Production default; override with MODULEFETCH_LOG_DIR. */
export const DEFAULT_MODULEFETCH_DIR = "/var/log/modulefetch";

export function getModuleFetchDir(): string {
  const fromEnv = process.env.MODULEFETCH_LOG_DIR?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_MODULEFETCH_DIR;
}

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

/** Deletes `*.zip` in `dir` whose mtime is older than one year. Returns count removed. */
export async function purgeOldModuleFetchZips(dir: string): Promise<number> {
  const now = Date.now();
  let removed = 0;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".zip")) continue;
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
export async function maybePurgeOldZips(dir: string): Promise<void> {
  const t = Date.now();
  if (t - lastPurgeTime < PURGE_INTERVAL_MS) return;
  lastPurgeTime = t;
  await purgeOldModuleFetchZips(dir);
}

function sanitizeFilePart(s: string, maxLen: number): string {
  const out = s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, maxLen);
  return out.length > 0 ? out : "anon";
}

/**
 * Writes one zip per ingest, containing a single `modulefetch.json` at the archive root
 * (stable path for downstream sync tools such as cdn-auto).
 */
export async function writeModuleFetchSessionZip(
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
  const filename = `mf-${sanitizeFilePart(stamp, 48)}-${rand}.zip`;
  const outPath = path.join(dir, filename);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", reject);
    output.on("error", reject);
    output.on("close", () => resolve());
    archive.pipe(output);
    archive.append(json, { name: "modulefetch.json" });
    void archive.finalize().catch(reject);
  });

  return { filename };
}
