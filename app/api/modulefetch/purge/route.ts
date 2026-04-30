import { NextRequest, NextResponse } from "next/server";
import { isModuleFetchAuthorized } from "@/lib/moduleFetchAuth";
import {
  getModuleFetchDir,
  purgeOldModuleFetchZips,
} from "@/lib/moduleFetchStore";

export const dynamic = "force-dynamic";

/** Run retention from cron when traffic is low; same auth as ingest. */
export async function POST(request: NextRequest) {
  if (!isModuleFetchAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dir = getModuleFetchDir();
  try {
    const removed = await purgeOldModuleFetchZips(dir);
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    console.error("[modulefetch] purge failed:", e);
    return NextResponse.json(
      { error: "Purge failed", detail: String(e) },
      { status: 500 }
    );
  }
}
