/** Normalize log identity for matching Prisma `User.email`. */
export function normalizeUserPoolLookupKey(login: string): string {
  const t = login.trim();
  if (!t || t === "Guest") return t;
  return t.toLowerCase();
}

export function resolveDisplayNameFromMap(
  map: Record<string, string>,
  rawLogin: string
): string {
  if (rawLogin === "Guest") return "Guest";
  const k = normalizeUserPoolLookupKey(rawLogin);
  return map[k] ?? rawLogin;
}
