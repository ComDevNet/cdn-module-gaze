import { extractModuleIdFromLogLine } from "@/lib/modulePath";

export type ParsedModuleAccess = {
  ip: string;
  username: string;
  module: string;
};

/**
 * Prefer identity from proxy headers / URL params when combined logs use `-`
 * for the Apache-style remote user field.
 */
function extractUsernameFromLogLine(logLine: string): string {
  const headerPatterns = [
    /\b(?:x-remote-user|x-auth-request-user|x-forwarded-user|x-authenticated-user)\s*[:=]\s*([^\s,;"']+)/i,
    /\bremote-user\s*[:=]\s*([^\s,;"']+)/i,
  ];
  for (const re of headerPatterns) {
    const m = re.exec(logLine);
    if (m?.[1]) {
      const v = m[1].replace(/^["']|["']$/g, "");
      if (v && v !== "-") return v;
    }
  }

  for (const m of logLine.matchAll(
    /(?:[?&])(?:user|username|login|email|sub)=([^&\s"']+)/gi
  )) {
    const raw = m[1];
    if (!raw || raw === "-") continue;
    try {
      const v = decodeURIComponent(raw.replace(/\+/g, " "));
      if (v) return v;
    } catch {
      if (raw) return raw;
    }
  }

  const userTok = logLine.match(
    /info:\s*(?:::ffff:)?\d+\.\d+\.\d+\.\d+\s+(\S+)\s+\[/
  );
  if (userTok?.[1] && userTok[1] !== "-") return userTok[1];

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
  const ipMatch = logLine.match(/info:\s*(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)/);
  const moduleInfo = extractModuleIdFromLogLine(logLine);
  if (!ipMatch || !moduleInfo) return null;

  const ip = ipMatch[1];
  const moduleName = moduleInfo.moduleId;
  const username = extractUsernameFromLogLine(logLine);

  return { ip, username, module: moduleName };
}
