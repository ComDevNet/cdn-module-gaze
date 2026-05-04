import { prisma } from "@/lib/prisma";
import { normalizeUserPoolLookupKey } from "@/lib/userPoolKey";

let cache = new Map<string, string>();
let lastLoadMs = 0;
const TTL_MS = 60_000;

type UserPoolRow = {
  email: string;
  name: string;
};

type UserColumnRow = {
  column_name: string;
};

async function resolveUserDisplayColumn(): Promise<"name" | "full_name" | null> {
  try {
    const cols = await prisma.$queryRaw<UserColumnRow[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'User'
        AND column_name IN ('name', 'full_name')
    `;
    const names = new Set(cols.map((c) => c.column_name));
    if (names.has("name")) return "name";
    if (names.has("full_name")) return "full_name";
    return null;
  } catch {
    return null;
  }
}

async function loadUserPoolRows(): Promise<UserPoolRow[]> {
  try {
    const displayCol = await resolveUserDisplayColumn();
    if (displayCol) {
      const rows = await prisma.$queryRawUnsafe<UserPoolRow[]>(
        `SELECT email, ${displayCol} AS name FROM "User" WHERE email IS NOT NULL AND ${displayCol} IS NOT NULL`
      );
      return rows
        .map((r) => ({
          email: r.email,
          name: r.name,
        }))
        .filter((r) => typeof r.email === "string" && typeof r.name === "string");
    }

    const rows = await prisma.user.findMany({
      select: { email: true, name: true },
    });
    return rows
      .map((r) => ({
        email: r.email,
        name: r.name,
      }))
      .filter((r) => typeof r.email === "string" && typeof r.name === "string");
  } catch (firstError) {
    // Compatibility fallback for deployments where introspection failed but full_name exists.
    try {
      const rows = await prisma.$queryRaw<UserPoolRow[]>`
        SELECT email, full_name AS name
        FROM "User"
        WHERE email IS NOT NULL AND full_name IS NOT NULL
      `;
      return rows
        .map((r) => ({
          email: r.email,
          name: r.name,
        }))
        .filter((r) => typeof r.email === "string" && typeof r.name === "string");
    } catch (fallbackError) {
      console.error("[userPool] primary load failed:", firstError);
      console.error("[userPool] full_name fallback failed:", fallbackError);
      return [];
    }
  }
}

export async function refreshUserPoolCache(force = false): Promise<void> {
  const now = Date.now();
  if (!force && lastLoadMs > 0 && now - lastLoadMs < TTL_MS) return;
  try {
    const rows = await loadUserPoolRows();
    const next = new Map<string, string>();
    for (const r of rows) {
      const email = r.email.trim();
      const displayName = r.name.trim();
      if (!email || !displayName) continue;
      next.set(normalizeUserPoolLookupKey(email), displayName);
    }
    cache = next;
    lastLoadMs = now;
  } catch (e) {
    console.error("[userPool] refresh failed:", e);
  }
}

export function resolveDisplayNameFromCache(rawLogin: string): string {
  if (rawLogin === "Guest") return "Guest";
  const hit = cache.get(normalizeUserPoolLookupKey(rawLogin));
  return hit && hit.length > 0 ? hit : rawLogin;
}

export function getUserPoolMapSnapshot(): Record<string, string> {
  return Object.fromEntries(cache.entries());
}
