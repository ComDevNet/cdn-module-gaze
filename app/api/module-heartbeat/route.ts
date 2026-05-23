import { NextRequest, NextResponse } from "next/server";
import {
  recordModuleHeartbeat,
  endModuleSession,
} from "@/lib/serverBackgroundSessions";
import { normalizeIdentityValue } from "@/lib/oc4dLogLine";
import { isBackgroundModuleMonitorEnabled } from "@/lib/serverBackgroundModuleMonitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS: Record<string, string> = {
  // Module pages may be served from `oc4d.cdn`, the LAN IP, or the hotspot
  // IP. Browsers POST the heartbeat cross-origin to this endpoint, so we
  // accept any origin. The endpoint is idempotent and writes to in-memory
  // state only; there is no stored credential or session cookie to leak.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

function clientIp(req: NextRequest): string {
  // x-forwarded-for is set by oc4d's morgan as the canonical client IP.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim() ?? "";
    if (first) return first.replace(/^::ffff:/, "");
  }
  // Next.js provides `req.ip` on Node runtime; fall back to nothing if absent.
  // (Older Next versions do not expose `ip`, hence the cast.)
  const direct = (req as unknown as { ip?: string }).ip;
  if (direct) return direct.replace(/^::ffff:/, "");
  return "";
}

function isLoopback(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0") return true;
  return ip.startsWith("127.");
}

function loopbackTrackingEnabled(): boolean {
  const v = process.env.MODULEGAZE_INCLUDE_LOOPBACK?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isBackgroundModuleMonitorEnabled()) {
    // Background monitor is the source of truth for the in-memory session
    // store; if it is off, accepting heartbeats would create rows that
    // nothing else maintains. Quietly accept and discard.
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug")?.trim() ?? "";
  const userRaw = url.searchParams.get("user")?.trim() ?? "";
  const event = url.searchParams.get("event")?.trim().toLowerCase() ?? "";

  if (!slug || (event !== "ping" && event !== "close")) {
    return new NextResponse("bad request", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const ip = clientIp(req);
  if (!ip) {
    // No IP we can attribute to → drop silently to avoid creating
    // "unknown" sessions that never go away.
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }
  if (isLoopback(ip) && !loopbackTrackingEnabled()) {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  const username = normalizeIdentityValue(userRaw) || "Guest";

  if (event === "ping") {
    recordModuleHeartbeat(ip, username, slug);
  } else {
    endModuleSession(ip, username, slug);
  }

  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
