/**
 * Browser → same-origin POST /api/modulefetch/ingest (writes a zip under
 * MODULEFETCH_LOG_DIR, default /var/log/modulegaze).
 * If MODULEFETCH_INGEST_SECRET is set on the server, this returns 401 unless
 * you add a trusted server-side caller; leave the secret unset on private LANs
 * for this UI flush to work.
 *
 * Live nginx/journal lines are not written here; use MODULEGAZE_TEE_ACCESS_LOG=1
 * on the server to append module-related lines to modulegaze-access.log, or
 * MODULEFETCH_PERIODIC_FLUSH_MINUTES (see /api/stats) for timed zip snapshots.
 */
export async function postModulefetchIngest(payload: {
  userId: string;
  moduleId: string;
  durationSeconds: number;
  recordedAt?: string;
}): Promise<boolean> {
  try {
    const res = await fetch("/api/modulefetch/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: payload.userId,
        moduleId: payload.moduleId,
        durationSeconds: Math.max(0, Math.floor(payload.durationSeconds)),
        recordedAt: payload.recordedAt ?? new Date().toISOString(),
      }),
    });
    if (res.status === 401) {
      console.warn(
        "[modulefetch] ingest returned 401 — set MODULEFETCH_INGEST_SECRET only if you also proxy authenticated writes from a backend."
      );
      return false;
    }
    return res.ok;
  } catch (e) {
    console.warn("[modulefetch] ingest request failed:", e);
    return false;
  }
}

export function sessionToModulefetchUserId(session: {
  username: string;
  ip: string;
}): string {
  return `${session.username}|${session.ip}`;
}
