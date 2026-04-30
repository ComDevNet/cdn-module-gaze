import { NextRequest, NextResponse } from "next/server";
import { isModuleFetchAuthorized } from "@/lib/moduleFetchAuth";
import {
  ensureModuleFetchDir,
  getModuleFetchDir,
  maybePurgeOldArchives,
  writeModuleFetchSessionTarGz,
} from "@/lib/moduleFetchStore";

export const dynamic = "force-dynamic";

function parseIngestBody(body: unknown): {
  userId: string;
  moduleId: string;
  durationSeconds: number;
  recordedAt?: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const userId = typeof o.userId === "string" ? o.userId.trim() : "";
  const moduleId = typeof o.moduleId === "string" ? o.moduleId.trim() : "";
  const durationSeconds = Number(o.durationSeconds);
  const recordedAt =
    typeof o.recordedAt === "string" && o.recordedAt.length > 0
      ? o.recordedAt
      : undefined;

  if (!userId || !moduleId) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return null;

  return { userId, moduleId, durationSeconds, recordedAt };
}

/**
 * POST JSON: { userId, moduleId, durationSeconds, recordedAt? }
 * Optional auth: MODULEFETCH_INGEST_SECRET + header `x-modulefetch-secret` or `Authorization: Bearer …`
 * Writes `mf-*.tar.gz` under MODULEFETCH_LOG_DIR or /var/log/modulegaze with inner file `modulefetch.json`.
 */
export async function POST(request: NextRequest) {
  if (!isModuleFetchAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseIngestBody(raw);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Invalid payload: require string userId, string moduleId, non-negative finite durationSeconds",
      },
      { status: 400 }
    );
  }

  const dir = getModuleFetchDir();
  try {
    await ensureModuleFetchDir(dir);
    const { filename } = await writeModuleFetchSessionTarGz(dir, parsed);
    void maybePurgeOldArchives(dir).catch((e) =>
      console.error("[modulefetch] retention purge failed:", e)
    );
    return NextResponse.json({ ok: true, filename });
  } catch (e) {
    console.error("[modulefetch] ingest failed:", e);
    return NextResponse.json(
      { error: "Failed to write archive", detail: String(e) },
      { status: 500 }
    );
  }
}
