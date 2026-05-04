import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOc4dModuleAccessLine,
  parseOc4dModuleAssetHeartbeat,
} from "@/lib/oc4dLogLine";

test("parses identity from trailing JSON", () => {
  const line =
    'May 04 00:00:00 host oc4d[1]: info: ::ffff:192.168.1.20 - [2026-05-04T00:00:00.000Z] "GET /modules/cdn_math/content/index.html HTTP/1.1" 200 {"email":"teacher@example.com"}';
  const parsed = parseOc4dModuleAccessLine(line);
  assert.ok(parsed);
  assert.equal(parsed.username, "teacher@example.com");
  assert.equal(parsed.ip, "192.168.1.20");
  assert.equal(parsed.module, "cdn_math");
});

test("parses identity from proxy headers and normalizes values", () => {
  const line =
    'May 04 00:00:00 host oc4d[1]: info: 192.168.1.21 - [2026-05-04T00:00:00.000Z] "GET /modules/cdn_science/content/index.html?x=1 HTTP/1.1" 200 x-remote-user="mailto:student@example.com"';
  const parsed = parseOc4dModuleAccessLine(line);
  assert.ok(parsed);
  assert.equal(parsed.username, "student@example.com");
  assert.equal(parsed.module, "cdn_science");
});

test("parses identity from query parameters when remote user token is '-'", () => {
  const line =
    'May 04 00:00:00 host oc4d[1]: info: 192.168.1.22 - [2026-05-04T00:00:00.000Z] "GET /modules/cdn_english/content/index.html?preferred_username=reader%40example.com HTTP/1.1" 200';
  const parsed = parseOc4dModuleAccessLine(line);
  assert.ok(parsed);
  assert.equal(parsed.username, "reader@example.com");
});

test("parses IPv6 addresses for access and heartbeat lines", () => {
  const accessLine =
    'May 04 00:00:00 host oc4d[1]: info: 2001:db8::15 user42 [2026-05-04T00:00:00.000Z] "GET /modules/cdn_geo/content/index.html HTTP/1.1" 200';
  const access = parseOc4dModuleAccessLine(accessLine);
  assert.ok(access);
  assert.equal(access.ip, "2001:db8::15");
  assert.equal(access.username, "user42");
  assert.equal(access.module, "cdn_geo");

  const heartbeatLine =
    'May 04 00:00:01 host oc4d[1]: info: 2001:db8::15 user42 [2026-05-04T00:00:01.000Z] "GET /modules/cdn_geo/content/chunk.js HTTP/1.1" 200';
  const heartbeat = parseOc4dModuleAssetHeartbeat(heartbeatLine);
  assert.ok(heartbeat);
  assert.equal(heartbeat.ip, "2001:db8::15");
  assert.equal(heartbeat.username, "user42");
  assert.equal(heartbeat.module, "cdn_geo");
});

test("falls back to Guest when no identity is available", () => {
  const line =
    'May 04 00:00:00 host oc4d[1]: info: 10.1.2.3 - [2026-05-04T00:00:00.000Z] "GET /modules/cdn_history/content/index.html HTTP/1.1" 200';
  const parsed = parseOc4dModuleAccessLine(line);
  assert.ok(parsed);
  assert.equal(parsed.username, "Guest");
});

test("parses identity from oc4d morgan `user=<email>` token", () => {
  const line =
    'May 04 14:30:00 cdn oc4d[5471]: info: 192.168.1.20 user=teacher@example.com - [2026-05-04T14:30:00.000Z] "GET /uploads/modules/1763389063089_v6sji3qt1/cdn_math/index.html HTTP/1.1" 200 1234 "-" "Mozilla/5.0" {"timestamp":"2026-05-04T14:30:00.000Z"}';
  const parsed = parseOc4dModuleAccessLine(line);
  assert.ok(parsed);
  assert.equal(parsed.ip, "192.168.1.20");
  assert.equal(parsed.username, "teacher@example.com");
  assert.equal(parsed.module, "cdn_math");
});

test("morgan `user=anonymous` token resolves to Guest", () => {
  const line =
    'May 04 14:30:00 cdn oc4d[5471]: info: 192.168.1.20 user=anonymous - [2026-05-04T14:30:00.000Z] "GET /modules/cdn_geo/content/index.html HTTP/1.1" 200 1234';
  const parsed = parseOc4dModuleAccessLine(line);
  assert.ok(parsed);
  assert.equal(parsed.username, "Guest");
});

test("morgan `user=` token does not get confused with `?user=` query strings", () => {
  // No leading whitespace before `user=` inside the URL → must not match the
  // morgan-token rule. Should fall through to the query-string scanner.
  const line =
    'May 04 14:30:00 cdn oc4d[5471]: info: 192.168.1.20 - [2026-05-04T14:30:00.000Z] "GET /modules/cdn_x/content/index.html?user=urlpicked@example.com HTTP/1.1" 200';
  const parsed = parseOc4dModuleAccessLine(line);
  assert.ok(parsed);
  assert.equal(parsed.username, "urlpicked@example.com");
});

test("morgan `user=<email>` token also works for asset heartbeats", () => {
  const line =
    'May 04 14:30:01 cdn oc4d[5471]: info: 192.168.1.20 user=teacher@example.com - [2026-05-04T14:30:01.000Z] "GET /uploads/modules/1763389063089_v6sji3qt1/cdn_math/assets/app.js HTTP/1.1" 200 5678';
  const heartbeat = parseOc4dModuleAssetHeartbeat(line);
  assert.ok(heartbeat);
  assert.equal(heartbeat.username, "teacher@example.com");
  assert.equal(heartbeat.module, "cdn_math");
});

test("drops loopback (127.0.0.1) traffic by default — keeps test curls out of analytics", () => {
  delete process.env.MODULEGAZE_INCLUDE_LOOPBACK;
  const access =
    'May 04 14:30:00 cdn oc4d[5471]: info: 127.0.0.1 user=teacher@example.com - [2026-05-04T14:30:00.000Z] "GET /modules/cdn_math/content/index.html HTTP/1.1" 200';
  assert.equal(parseOc4dModuleAccessLine(access), null);

  const heartbeat =
    'May 04 14:30:01 cdn oc4d[5471]: info: 127.0.0.1 user=teacher@example.com - [2026-05-04T14:30:01.000Z] "GET /modules/cdn_math/content/app.js HTTP/1.1" 200';
  assert.equal(parseOc4dModuleAssetHeartbeat(heartbeat), null);
});

test("drops IPv6 loopback (::1) and ::ffff:127.0.0.1 too", () => {
  delete process.env.MODULEGAZE_INCLUDE_LOOPBACK;
  const v6 =
    'May 04 14:30:00 cdn oc4d[5471]: info: ::1 user=robot@example.com - [2026-05-04T14:30:00.000Z] "GET /modules/cdn_math/content/index.html HTTP/1.1" 200';
  assert.equal(parseOc4dModuleAccessLine(v6), null);

  const mapped =
    'May 04 14:30:00 cdn oc4d[5471]: info: ::ffff:127.0.0.1 user=robot@example.com - [2026-05-04T14:30:00.000Z] "GET /modules/cdn_math/content/index.html HTTP/1.1" 200';
  assert.equal(parseOc4dModuleAccessLine(mapped), null);
});

test("MODULEGAZE_INCLUDE_LOOPBACK=1 enables loopback tracking for local dev", () => {
  process.env.MODULEGAZE_INCLUDE_LOOPBACK = "1";
  try {
    const line =
      'May 04 14:30:00 cdn oc4d[5471]: info: 127.0.0.1 user=devuser@example.com - [2026-05-04T14:30:00.000Z] "GET /modules/cdn_math/content/index.html HTTP/1.1" 200';
    const parsed = parseOc4dModuleAccessLine(line);
    assert.ok(parsed);
    assert.equal(parsed.ip, "127.0.0.1");
    assert.equal(parsed.username, "devuser@example.com");
  } finally {
    delete process.env.MODULEGAZE_INCLUDE_LOOPBACK;
  }
});
