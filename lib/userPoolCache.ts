import { prisma } from "@/lib/prisma";
import { normalizeUserPoolLookupKey } from "@/lib/userPoolKey";

let cache = new Map<string, string>();
let lastLoadMs = 0;
const TTL_MS = 60_000;

export async function refreshUserPoolCache(force = false): Promise<void> {
  const now = Date.now();
  if (!force && lastLoadMs > 0 && now - lastLoadMs < TTL_MS) return;
  try {
    const rows = await prisma.user.findMany({
      select: { email: true, name: true },
    });
    const next = new Map<string, string>();
    for (const r of rows) {
      next.set(normalizeUserPoolLookupKey(r.email), r.name.trim());
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
