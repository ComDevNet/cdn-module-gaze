/**
 * Path helpers for oc4d / CDN module URLs. Module slug is the first path
 * segment after "/modules/" (e.g. /modules/cdn_foo/content/... -> cdn_foo).
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

/** First segment after /modules/ from a path or full URL. */
export function extractModuleIdFromPath(pathOrUrl: string): string | null {
  const pathname = decodePathSafe(getPathname(pathOrUrl));
  if (!pathname) return null;

  const match = pathname.match(/\/modules\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function looksLikeUserAgent(quoted: string): boolean {
  return /^Mozilla\//i.test(quoted) || /^Opera\//i.test(quoted);
}

/**
 * Resolve module id from a log line: try GET path first, then quoted URLs
 * (Referer, etc.) when GET is not under /modules/.
 */
export function extractModuleIdFromLogLine(logLine: string): {
  moduleId: string;
  source: "get" | "quoted";
} | null {
  const getMatch = logLine.match(/"GET\s+([^\s"]+)/);
  if (getMatch?.[1]) {
    const fromGet = extractModuleIdFromPath(getMatch[1]);
    if (fromGet) return { moduleId: fromGet, source: "get" };
  }

  for (const m of logLine.matchAll(/"([^"]*)"/g)) {
    const quoted = m[1];
    if (!quoted || quoted.startsWith("GET ") || looksLikeUserAgent(quoted)) {
      continue;
    }
    if (!quoted.includes("/modules/")) continue;
    const fromQuoted = extractModuleIdFromPath(quoted);
    if (fromQuoted) return { moduleId: fromQuoted, source: "quoted" };
  }

  return null;
}
