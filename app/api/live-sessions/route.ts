import { NextResponse } from "next/server";
import { getLiveSessionsSnapshot } from "@/lib/serverBackgroundSessions";
import { isBackgroundModuleMonitorEnabled } from "@/lib/serverBackgroundModuleMonitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const enabled = isBackgroundModuleMonitorEnabled();
  return NextResponse.json({
    enabled,
    sessions: enabled ? getLiveSessionsSnapshot() : [],
  });
}
