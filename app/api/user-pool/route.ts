import { NextRequest, NextResponse } from "next/server";
import {
  getUserPoolMapSnapshot,
  refreshUserPoolCache,
} from "@/lib/userPoolCache";

/** Maps normalized `User.email` → `User.name` for the dashboard. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  await refreshUserPoolCache(force);
  return NextResponse.json({ map: getUserPoolMapSnapshot() });
}
