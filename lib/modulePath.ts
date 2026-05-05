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
 * From ordered path segments under `/modules/...` or `/uploads/modules/...`,
 * pick the slug. The convention is `/modules/<build>/<slug>/...` (with
 * `<build>` matching `DYNAMIC_MODULE_SEGMENT`) or `/modules/<slug>/...` for
 * legacy paths. The slug is the FIRST stable segment — anything after it is
 * sub-page or asset structure (e.g. `<slug>/img/foo.jpg`,
 * `<slug>/asset/index.html`) and must not be misattributed as a module id.
 *
 * The previous implementation returned `stable[stable.length - 1]`, which
 * caused real production logs to persist phantom modules named `img`,
 * `asset`, `asse`, `style`, etc. — every time a module had a sub-folder
 * whose name happened not to be in the asset-folder break list. Picking the
 * FIRST stable segment is correct under both URL conventions and immune
 * to whatever directory naming a module ships with on disk.
 */
export function preferStableModuleSegment(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const stable = candidates.filter((s) => !DYNAMIC_MODULE_SEGMENT.test(s));
  if (stable.length > 0) return stable[0];
  return candidates[0];
}

/**
 * Up to the first two path segments under `/uploads/modules/...` or
 * `/modules/...`. That's exactly how many we need to identify the module:
 *
 *   /uploads/modules/<build>/<slug>/...   → ["<build>", "<slug>"]
 *   /modules/<build>/<slug>/...           → ["<build>", "<slug>"]
 *   /modules/<slug>/...                   → ["<slug>"] (or ["<slug>", "<sub>"])
 *
 * Anything beyond the slug is either sub-page navigation (e.g.
 * `<slug>/img/index.html`) or asset folder structure (e.g.
 * `<slug>/asset/web/foo.css`, `<slug>/img/big-book.jpg`). Including those
 * downstream segments was the root cause of phantom moduleIds like
 * `asset`, `asse`, `img`, `style`, etc., showing up in
 * `modulegaze-sessions.log`. Keeping the candidate list trimmed to two
 * makes `preferStableModuleSegment` robust regardless of how a module
 * organises its files on disk.
 */
function moduleSegmentsFromPathname(pathname: string): string[] {
  const uploads = pathname.match(/\/uploads\/modules\/(.+)/i);
  const plain = pathname.match(/\/modules\/(.+)/i);
  const tail = uploads?.[1] ?? plain?.[1];
  if (!tail) return [];
  const parts = tail.split("/").filter(Boolean);
  const out: string[] = [];
  for (const seg of parts.slice(0, 2)) {
    if (/\.[a-z0-9]{1,10}$/i.test(seg)) {
      // Reached a leaf file (e.g. `/modules/<slug>/index.html` where slug
      // is the first segment) — stop and let the caller pick from what we
      // have. Without this we would push `index.html` and then a stable
      // filter could return it as the moduleId.
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
