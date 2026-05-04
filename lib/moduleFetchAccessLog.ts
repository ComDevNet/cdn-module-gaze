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
  const { appendLineWithDailyZip } = await import("./dailyLogArchive");
  const dir = getModuleFetchDir();
  const oneLine = rawLine.replace(/\r?\n/g, " ").trim();
  const out = `${new Date().toISOString()}\t${oneLine}`;
  await appendLineWithDailyZip(dir, MODULEGAZE_ACCESS_LOG_NAME, out);
}
