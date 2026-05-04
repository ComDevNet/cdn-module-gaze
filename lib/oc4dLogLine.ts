import {
  extractModuleAssetActivitySlugFromLogLine,
  extractModuleIdFromLogLine,
} from "@/lib/modulePath";

export type ParsedModuleAccess = {
  ip: string;
  username: string;
  module: string;
};

const USERNAME_KEYS = [
  "user",
  "username",
  "login",
  "email",
  "sub",
  "remote_user",
  "preferred_username",
  "upn",
  "user_email",
  "mail",
  "nameid",
];

function normalizeIdentityValue(raw: string | null | undefined): string {
  if (!raw) return "";
  let out = raw.trim();
  out = out.replace(/^["']|["']$/g, "");
  out = out.replace(/[;,]+$/g, "");
  if (!out || out === "-") return "";
  if (out.toLowerCase().startsWith("mailto:")) {
    out = out.slice("mailto:".length);
  }
  if (out.includes("@")) {
    out = out.toLowerCase();
  }
  if (!out || out === "-") return "";
  if (/^guest$/i.test(out) || /^anonymous$/i.test(out)) return "Guest";
  return out;
}

function extractTrailingJsonObject(logLine: string): string | null {
  const end = logLine.lastIndexOf("}");
  if (end < 0) return null;
  let depth = 0;
  for (let i = end; i >= 0; i -= 1) {
    const ch = logLine[i];
    if (ch === "}") depth += 1;
    if (ch === "{") {
      depth -= 1;
      if (depth === 0) {
        return logLine.slice(i, end + 1);
      }
    }
  }
  return null;
}

/**
 * Pick a user-identity string out of the trailing JSON object that oc4d
 * appends to access log lines (e.g. `... {"timestamp":"...","user":"a@b"}`).
 * Returns null when the line has no parseable JSON suffix or the JSON has
 * no recognised identity field.
 */
function extractUsernameFromTrailingJson(logLine: string): string | null {
  const candidate = extractTrailingJsonObject(logLine);
  if (!candidate) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
  for (const k of USERNAME_KEYS) {
    const v = obj[k];
    if (typeof v === "string") {
      const t = normalizeIdentityValue(v);
      if (t) return t;
    }
  }
  return null;
}

function extractClientAddress(logLine: string): string | null {
  const m = /\binfo:\s*([^\s]+)\s+/.exec(logLine);
  if (!m?.[1]) return null;
  const token = m[1].replace(/^\[|\]$/g, "");
  const stripped = token.startsWith("::ffff:") ? token.slice(7) : token;
  return normalizeIdentityValue(stripped) || null;
}

/**
 * IPv4 / IPv6 loopback addresses we want to drop from user analytics by
 * default. Production users always come in over the LAN with a real
 * 192.168.x.x / 10.x.x.x IP — loopback traffic is exclusively from local
 * health checks, internal scrapers, or verification curls run on the Pi
 * itself, and was previously polluting the live-sessions panel with rows
 * like `teacher@example.com` and `testuser@example.com`.
 */
function isLoopbackAddress(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0") return true;
  return ip.startsWith("127.");
}

/** Set `MODULEGAZE_INCLUDE_LOOPBACK=1` for local dev where you DO want to track 127.0.0.1 traffic. */
function isLoopbackTrackingEnabled(): boolean {
  const v = process.env.MODULEGAZE_INCLUDE_LOOPBACK?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Match the `user=<value>` token oc4d emits between the IP and the timestamp
 * (morgan format `:remote-addr user=:user - [:ts] ...`). Anchored to leading
 * whitespace so URL query strings like `?user=foo` / `&user=foo` are NOT
 * matched here — those are handled by the query-parameter scanner below.
 */
function extractUsernameFromAccessLogUserToken(
  logLine: string
): string | null {
  const m = /\s+user=([^\s&"',;]+)/.exec(logLine);
  if (!m?.[1]) return null;
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    /* keep raw on decode failure */
  }
  return normalizeIdentityValue(raw) || null;
}

/**
 * Prefer identity from proxy headers / URL params when combined logs use `-`
 * for the Apache-style remote user field. Also reads identity from the
 * trailing JSON object oc4d emits on each access line.
 */
function extractUsernameFromLogLine(logLine: string): string {
  const fromJson = extractUsernameFromTrailingJson(logLine);
  if (fromJson) return fromJson;

  const fromUserToken = extractUsernameFromAccessLogUserToken(logLine);
  if (fromUserToken) return fromUserToken;

  const headerPatterns = [
    /\b(?:x-remote-user|x-auth-request-user|x-forwarded-user|x-authenticated-user|x-user-email|x-user|remote[_-]user)\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^\s,;]+))/i,
  ];
  for (const re of headerPatterns) {
    const m = re.exec(logLine);
    if (m) {
      const v = normalizeIdentityValue(m[1] ?? m[2] ?? m[3] ?? "");
      if (v) return v;
    }
  }

  for (const m of logLine.matchAll(
    /(?:[?&])(?:user|username|login|email|sub|upn|preferred_username|remote_user|user_email)=([^&\s"']+)/gi
  )) {
    const raw = m[1];
    if (!raw) continue;
    try {
      const v = normalizeIdentityValue(
        decodeURIComponent(raw.replace(/\+/g, " "))
      );
      if (v) return v;
    } catch {
      const v = normalizeIdentityValue(raw);
      if (v) return v;
    }
  }

  const userTok = /\binfo:\s*[^\s]+\s+(\S+)\s+\[/.exec(logLine);
  const parsedUserTok = normalizeIdentityValue(userTok?.[1]);
  if (parsedUserTok) return parsedUserTok;

  return "Guest";
}

/**
 * Parse oc4d-style journal lines for client IP, user identity, and module slug.
 *
 * Remote user after IP is either `-` (anonymous) or a login; headers / query
 * can carry the real user when the second field is `-`.
 */
export function parseOc4dModuleAccessLine(
  logLine: string
): ParsedModuleAccess | null {
  const moduleInfo = extractModuleIdFromLogLine(logLine);
  if (!moduleInfo) return null;
  const ip = extractClientAddress(logLine);
  if (!ip) return null;
  if (isLoopbackAddress(ip) && !isLoopbackTrackingEnabled()) return null;

  const moduleName = moduleInfo.moduleId;
  const username = extractUsernameFromLogLine(logLine);

  return { ip, username, module: moduleName };
}

/**
 * Same identity fields as `parseOc4dModuleAccessLine`, but for non-index module
 * GETs (assets). Used only to bump session `lastActivity` when the slug matches
 * the active session.
 */
export function parseOc4dModuleAssetHeartbeat(
  logLine: string
): ParsedModuleAccess | null {
  const moduleName = extractModuleAssetActivitySlugFromLogLine(logLine);
  if (!moduleName) return null;
  const ip = extractClientAddress(logLine);
  if (!ip) return null;
  if (isLoopbackAddress(ip) && !isLoopbackTrackingEnabled()) return null;
  const username = extractUsernameFromLogLine(logLine);
  return { ip, username, module: moduleName };
}
