import { NextRequest } from "next/server";

export function isModuleFetchAuthorized(request: NextRequest): boolean {
  const secret = process.env.MODULEFETCH_INGEST_SECRET?.trim();
  if (!secret) return true;
  const header =
    request.headers.get("x-modulefetch-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return header === secret;
}
