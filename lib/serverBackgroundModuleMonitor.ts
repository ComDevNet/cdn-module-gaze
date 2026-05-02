import {
  registerJournalHubInternalHandler,
  setJournalHubBackgroundPinned,
} from "@/lib/oc4dJournalHub";
import {
  processBackgroundJournalLine,
  runBackgroundSessionCleanup,
} from "@/lib/serverBackgroundSessions";
import { refreshUserPoolCache } from "@/lib/userPoolCache";

let started = false;
let tick: ReturnType<typeof setInterval> | null = null;

export function isBackgroundModuleMonitorEnabled(): boolean {
  const v = process.env.MODULEGAZE_BACKGROUND_MONITOR?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Start `journalctl` + in-memory sessions without any browser (see `instrumentation.ts`).
 * Idempotent.
 */
export function enableBackgroundModuleMonitor(): void {
  if (started) return;
  if (process.platform === "win32") {
    console.log(
      "[modulegaze] MODULEGAZE_BACKGROUND_MONITOR skipped on win32 (no journalctl)."
    );
    return;
  }
  if (!isBackgroundModuleMonitorEnabled()) return;

  started = true;
  void refreshUserPoolCache(true);
  setInterval(() => {
    void refreshUserPoolCache(false);
  }, 60_000);
  setJournalHubBackgroundPinned(true);
  registerJournalHubInternalHandler(processBackgroundJournalLine);
  tick = setInterval(() => {
    runBackgroundSessionCleanup();
  }, 1000);
  console.log(
    "[modulegaze] Background module monitor ON — sessions at GET /api/live-sessions"
  );
}
