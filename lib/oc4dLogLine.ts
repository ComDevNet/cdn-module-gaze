import { extractModuleIdFromLogLine } from "@/lib/modulePath";

export type ParsedModuleAccess = {
  ip: string;
  username: string;
  module: string;
};

/**
 * Parse oc4d-style journal lines for client IP, optional user token, and module slug.
 *
 * Expected shape (remote user is either `-` or a login name before the ISO bracket):
 * `... info: ::ffff:192.168.1.10 - [2024-07-02T03:13:12.202Z] "GET /modules/slug/...`
 * `... info: ::ffff:192.168.1.10 alice [2024-07-02T03:13:12.202Z] "GET /modules/slug/...`
 */
export function parseOc4dModuleAccessLine(
  logLine: string
): ParsedModuleAccess | null {
  const ipMatch = logLine.match(/info:\s*(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)/);
  const moduleInfo = extractModuleIdFromLogLine(logLine);
  if (!ipMatch || !moduleInfo) return null;

  const ip = ipMatch[1];
  const moduleName = moduleInfo.moduleId;

  const userTok = logLine.match(
    /info:\s*(?:::ffff:)?\d+\.\d+\.\d+\.\d+\s+(\S+)\s+\[/
  );
  let username = "Guest";
  if (userTok?.[1] && userTok[1] !== "-") username = userTok[1];

  return { ip, username, module: moduleName };
}

/** Synthetic line compatible with {@link parseOc4dModuleAccessLine}. */
export function formatOc4dModuleAccessLogLine(params: {
  ip: string;
  username: string;
  moduleSlug: string;
  assetPath?: string;
}): string {
  const userField =
    params.username.trim() && params.username !== "Guest"
      ? params.username.trim()
      : "-";
  const slug = params.moduleSlug;
  const requestLine =
    params.assetPath ??
    `GET /modules/${slug}/content/node/demo.html HTTP/1.1`;
  const ts = new Date().toISOString();
  const referer = `http://oc4d.cdn/modules/${slug}/content/index.html`;
  return `Apr 30 12:00:00 cdn oc4d[9999]: info: ::ffff:${params.ip} ${userField} [${ts}] "${requestLine}" 200 - "${referer}" "Mozilla/5.0 (module-gaze-demo)"`;
}
