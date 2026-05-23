import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import archiver from "archiver";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function localDayStamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function zipSingleFile(filePath: string): Promise<string> {
  const zipPath = `${filePath}.zip`;
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", reject);
    output.on("error", reject);
    output.on("close", () => resolve());
    archive.pipe(output);
    archive.file(filePath, { name: path.basename(filePath) });
    void archive.finalize().catch(reject);
  });
  return zipPath;
}

async function rotateIfNeeded(dir: string, baseName: string, dayStamp: string): Promise<void> {
  const active = path.join(dir, baseName);
  let st;
  try {
    st = await fs.stat(active);
  } catch {
    return;
  }

  const activeStamp = localDayStamp(new Date(st.mtimeMs));
  if (activeStamp === dayStamp) return;

  const ext = path.extname(baseName) || ".log";
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  let rotated = path.join(dir, `${stem}-${activeStamp}${ext}`);
  if (await pathExists(rotated)) {
    rotated = path.join(dir, `${stem}-${activeStamp}-${Date.now()}${ext}`);
  }

  try {
    await fs.rename(active, rotated);
  } catch {
    return;
  }
  await zipSingleFile(rotated);
  await fs.unlink(rotated).catch(() => {
    /* ignore */
  });
}

export async function appendLineWithDailyZip(
  dir: string,
  baseName: string,
  line: string,
  now: Date = new Date()
): Promise<{ filename: string }> {
  await fs.mkdir(dir, { recursive: true });
  const today = localDayStamp(now);
  await rotateIfNeeded(dir, baseName, today);
  const oneLine = line.replace(/\r?\n/g, " ").trim();
  await fs.appendFile(path.join(dir, baseName), `${oneLine}\n`, "utf8");
  return { filename: baseName };
}
