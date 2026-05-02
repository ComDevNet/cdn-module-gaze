/**
 * Access-log tee — no top-level `fs` so this module is safe to import from code
 * loaded during Next `instrumentation` bundling.
 */
import {
  getModuleFetchDir,
  MODULEGAZE_ACCESS_LOG_NAME,
} from "@/lib/moduleFetchPaths";

export { MODULEGAZE_ACCESS_LOG_NAME };

export function isAccessLogTeeEnabled(): boolean {
  const v = process.env.MODULEGAZE_TEE_ACCESS_LOG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function appendModulegazeAccessLogLine(
  rawLine: string
): Promise<void> {
  if (!isAccessLogTeeEnabled()) return;
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = getModuleFetchDir();
  await fs.mkdir(dir, { recursive: true });
  const oneLine = rawLine.replace(/\r?\n/g, " ").trim();
  const out = `${new Date().toISOString()}\t${oneLine}\n`;
  await fs.appendFile(
    path.join(dir, MODULEGAZE_ACCESS_LOG_NAME),
    out,
    "utf8"
  );
}
