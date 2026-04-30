/**
 * Path helpers for oc4d / CDN module URLs.
 * Supports `/modules/<slug>/...` and `/uploads/modules/<buildId>/<slug>/...`
 * (stable slug is preferred over numeric_build segments).
 */

export function getPathname(pathOrUrl: string): string {
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return "";

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) {
    try {
      return new URL(trimmed).pathname;
    } catch {
      /* ignore invalid absolute URL */
    }
  }

  const noHash = trimmed.split("#")[0] ?? "";
  return (noHash.split("?")[0] ?? "").trim();
}

function decodePathSafe(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Preferred module slug for DB matching: stable segment from `/modules/...`
 * or `/uploads/modules/<build>/<slug>/...` (e.g. `cdn_verbs`).
 */
export function extractModuleIdFromPath(pathOrUrl: string): string | null {
  const pathname = decodePathSafe(getPathname(pathOrUrl));
  if (!pathname) return null;
  const segments = moduleSegmentsFromPathname(pathname);
  return preferStableModuleSegment(segments);
}

/** e.g. oc4d build/instance id `1763387547577_khemf99ie` vs stable slug `cdn_acid_bases_and_salts` */
const DYNAMIC_MODULE_SEGMENT = /^\d{10,}_[a-zA-Z0-9_-]+$/;

/**
 * From ordered path segments (GET then Referer, etc.), prefer a stable slug
 * over a numeric_instance id so DB `indexHtmlUrl` matching works.
 */
export function preferStableModuleSegment(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const stable = candidates.filter((s) => !DYNAMIC_MODULE_SEGMENT.test(s));
  if (stable.length > 0) return stable[stable.length - 1];
  return candidates[0];
}

/**
 * Path segments under `/uploads/modules/...` or `/modules/...` until a static
 * folder or file (e.g. `/uploads/modules/<build>/cdn_verbs/index.html` →
 * `["<build>", "cdn_verbs"]`).
 */
function moduleSegmentsFromPathname(pathname: string): string[] {
  const uploads = pathname.match(/\/uploads\/modules\/(.+)/i);
  const plain = pathname.match(/\/modules\/(.+)/i);
  const tail = uploads?.[1] ?? plain?.[1];
  if (!tail) return [];
  const parts = tail.split("/").filter(Boolean);
  const out: string[] = [];
  for (const seg of parts) {
    const lower = seg.toLowerCase();
    if (
      ["content", "node", "static", "assets", "dist", "build", "public"].includes(
        lower
      )
    ) {
      break;
    }
    if (/\.[a-z0-9]{1,10}$/i.test(seg)) {
      break;
    }
    out.push(decodePathSafe(seg));
  }
  return out;
}

/**
 * Only treat true module navigations (entry `index.html`), not asset/chunk
 * GETs while scrolling, and use the GET path only (Referer must not override).
 */
function isModuleEntryPathname(pathname: string): boolean {
  const p = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "");
  if (!p.toLowerCase().endsWith("/index.html")) return false;
  if (p.includes("/uploads/modules/")) {
    return /\/uploads\/modules\/[^/]+\/[^/]+\/index\.html$/i.test(p);
  }
  if (p.includes("/modules/")) {
    return /\/modules\/.+\/index\.html$/i.test(p);
  }
  return false;
}

/**
 * Stable slug from a **non-entry** GET still under module CDN paths (chunks, css,
 * etc.). Used to refresh `lastActivity` while someone stays in a module without
 * reloading `index.html`. Returns null for entry navigations (use
 * `extractModuleIdFromLogLine` for those).
 */
export function extractModuleAssetActivitySlugFromLogLine(
  logLine: string
): string | null {
  const getMatch = logLine.match(/"GET\s+([^\s"]+)/);
  if (!getMatch?.[1]) return null;
  const pathname = decodePathSafe(getPathname(getMatch[1]));
  if (!pathname.includes("/modules/") && !pathname.includes("/uploads/modules/")) {
    return null;
  }
  if (isModuleEntryPathname(pathname)) return null;
  return extractModuleIdFromPath(pathname);
}

/**
 * Module slug from the **GET** request only (avoids wrong module from Referer).
 * Ignores non-entry requests (e.g. `.js` under `/uploads/modules/...`).
 */
export function extractModuleIdFromLogLine(logLine: string): {
  moduleId: string;
  source: "get";
} | null {
  const getMatch = logLine.match(/"GET\s+([^\s"]+)/);
  if (!getMatch?.[1]) return null;

  const pathname = decodePathSafe(getPathname(getMatch[1]));
  if (!pathname.includes("/modules/") && !pathname.includes("/uploads/modules/")) {
    return null;
  }
  if (!isModuleEntryPathname(pathname)) return null;

  const segments = moduleSegmentsFromPathname(pathname);
  const chosen = preferStableModuleSegment(segments);
  if (!chosen) return null;

  return { moduleId: chosen, source: "get" };
}
