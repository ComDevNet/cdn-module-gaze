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

function looksLikeUserAgent(quoted: string): boolean {
  return /^Mozilla\//i.test(quoted) || /^Opera\//i.test(quoted);
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

/** Collect module-related path segments from GET and quoted URLs in log order. */
export function collectModuleSegmentsFromLogLine(logLine: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const addFromPathOrUrl = (raw: string) => {
    const pathname = decodePathSafe(getPathname(raw));
    for (const seg of moduleSegmentsFromPathname(pathname)) {
      if (!seen.has(seg)) {
        seen.add(seg);
        ordered.push(seg);
      }
    }
  };

  const getMatch = logLine.match(/"GET\s+([^\s"]+)/);
  if (getMatch?.[1]) addFromPathOrUrl(getMatch[1]);

  for (const m of logLine.matchAll(/"([^"]*)"/g)) {
    const quoted = m[1];
    if (!quoted || quoted.startsWith("GET ") || looksLikeUserAgent(quoted)) {
      continue;
    }
    if (
      !quoted.includes("/modules/") &&
      !quoted.includes("/uploads/modules/")
    ) {
      continue;
    }
    addFromPathOrUrl(quoted);
  }

  return ordered;
}

/**
 * Resolve module id from a log line: gather segments from GET + quoted URLs,
 * then prefer a non-dynamic slug (e.g. `cdn_verbs` under `/uploads/modules/`).
 */
export function extractModuleIdFromLogLine(logLine: string): {
  moduleId: string;
  source: "get" | "quoted" | "merged";
} | null {
  const segments = collectModuleSegmentsFromLogLine(logLine);
  const chosen = preferStableModuleSegment(segments);
  if (!chosen) return null;

  const getMatch = logLine.match(/"GET\s+([^\s"]+)/);
  const fromGet = getMatch?.[1]
    ? extractModuleIdFromPath(getMatch[1])
    : null;
  const source: "get" | "quoted" | "merged" =
    fromGet === chosen ? "get" : fromGet ? "merged" : "quoted";

  return { moduleId: chosen, source };
}
