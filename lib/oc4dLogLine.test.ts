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
