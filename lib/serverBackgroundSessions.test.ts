import test from "node:test";
import assert from "node:assert/strict";
import {
  processBackgroundJournalLine,
  getLiveSessionsSnapshot,
} from "@/lib/serverBackgroundSessions";

/**
 * `serverBackgroundSessions` keeps state on a `globalThis`-pinned slot
 * (so the monitor and the route handlers share one in-memory store).
 * Tests need to clear that slot between cases.
 *
 * NOTE: the module captures `state` by reference at load time, so simply
 * reassigning `globalThis[KEY] = { rows: [] }` would only swap the global
 * slot — the live module would still hold the old array. Mutate the
 * array in place so the module sees an empty session list.
 */
function clearBackgroundSessions(): void {
  const key = Symbol.for("cdnModuleGaze.backgroundSessions.state");
  const g = globalThis as unknown as Record<symbol, { rows: unknown[] }>;
  const slot = g[key];
  if (slot && Array.isArray(slot.rows)) {
    slot.rows.length = 0;
    return;
  }
  g[key] = { rows: [] };
}

function entryLine(ip: string, user: string, slug: string): string {
  return `May 04 14:30:00 cdn oc4d[1]: info: ${ip} user=${user} - [2026-05-04T14:30:00.000Z] "GET /uploads/modules/1700000000000_aaaaaaaaa/${slug}/index.html HTTP/1.1" 200`;
}

function assetHeartbeat(ip: string, user: string, slug: string): string {
  return `May 04 14:30:01 cdn oc4d[1]: info: ${ip} user=${user} - [2026-05-04T14:30:01.000Z] "GET /uploads/modules/1700000000000_aaaaaaaaa/${slug}/assets/main.js HTTP/1.1" 200`;
}

test("entry log creates a session for the user", () => {
  clearBackgroundSessions();
  processBackgroundJournalLine(
    entryLine("192.168.1.20", "anna@example.com", "cdn_math")
  );
  const snap = getLiveSessionsSnapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0]?.username, "anna@example.com");
  assert.equal(snap[0]?.module, "cdn_math");
});

test("matching-module asset heartbeat bumps lastActivity, does not duplicate the session", () => {
  clearBackgroundSessions();
  processBackgroundJournalLine(
    entryLine("192.168.1.20", "anna@example.com", "cdn_math")
  );
  const before = getLiveSessionsSnapshot();
  assert.equal(before.length, 1);

  // Small delay so lastActivity actually moves forward.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return sleep(20).then(() => {
    processBackgroundJournalLine(
      assetHeartbeat("192.168.1.20", "anna@example.com", "cdn_math")
    );
    const after = getLiveSessionsSnapshot();
    assert.equal(after.length, 1);
    assert.equal(after[0]?.module, "cdn_math");
    assert.ok(
      new Date(after[0]!.lastActivity).getTime() >=
        new Date(before[0]!.lastActivity).getTime()
    );
  });
});

test("regression: thumbnail heartbeats for OTHER modules must NOT thrash an active session", () => {
  // Reproduces the bug seen in modulegaze-sessions.log where Anna's real
  // 4-minute view of one module was being replaced by dozens of 0-second
  // records every time the dashboard fanned out thumbnail fetches for
  // unrelated modules under `/uploads/modules/<buildId>/<other-slug>/...`.
  clearBackgroundSessions();
  processBackgroundJournalLine(
    entryLine("192.168.1.20", "anna@example.com", "2048")
  );
  // Dashboard fans out thumbnail loads for ~10 unrelated modules.
  for (const slug of [
    "cdn_algebra",
    "en-bookdash",
    "en-w3schools",
    "career-exploration",
    "shape",
    "fonts",
    "image-files",
    "support-files",
    "js",
    "style",
  ]) {
    processBackgroundJournalLine(
      assetHeartbeat("192.168.1.20", "anna@example.com", slug)
    );
  }
  const snap = getLiveSessionsSnapshot();
  assert.equal(snap.length, 1, "active session count must not grow");
  assert.equal(
    snap[0]?.module,
    "2048",
    "active module must not be replaced by thumbnail asset hits"
  );
});

test("cold-start case: heartbeat seeds a session when the user has none", () => {
  // Monitor starts after the user already navigated to a module. The
  // first signal we see is an asset heartbeat. We should still surface
  // them in the live-sessions panel (Anna's `eb6768f` intent).
  clearBackgroundSessions();
  processBackgroundJournalLine(
    assetHeartbeat("192.168.1.21", "bob@example.com", "cdn_geo")
  );
  const snap = getLiveSessionsSnapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0]?.username, "bob@example.com");
  assert.equal(snap[0]?.module, "cdn_geo");
});

test("logged-in user at the same IP retires the existing Guest session (sign-in promotion)", () => {
  // Same browser was Guest, then signed in. We must end up with ONE
  // session row for that IP, not two (Guest + signed-in name) — the
  // dashboard was previously showing both until Guest aged out.
  clearBackgroundSessions();
  processBackgroundJournalLine(
    entryLine("192.168.1.227", "anonymous", "en-w3schools")
  );
  let snap = getLiveSessionsSnapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0]?.username, "Guest");
  assert.equal(snap[0]?.module, "en-w3schools");

  processBackgroundJournalLine(
    entryLine("192.168.1.227", "anna@example.com", "CDN_Module")
  );
  snap = getLiveSessionsSnapshot();
  assert.equal(snap.length, 1, "Guest row at the same IP must be retired");
  assert.equal(snap[0]?.username, "anna@example.com");
  assert.equal(snap[0]?.module, "CDN_Module");
});

test("Guest at a DIFFERENT IP is not affected by another user's sign-in", () => {
  clearBackgroundSessions();
  processBackgroundJournalLine(
    entryLine("192.168.1.227", "anonymous", "en-w3schools")
  );
  processBackgroundJournalLine(
    entryLine("192.168.1.165", "anna@example.com", "CDN_Module")
  );
  const snap = getLiveSessionsSnapshot();
  assert.equal(snap.length, 2);
  const guest = snap.find((s) => s.ip === "192.168.1.227");
  assert.equal(guest?.username, "Guest");
  assert.equal(guest?.module, "en-w3schools");
});

test("late Guest heartbeat at an IP owned by a logged-in user is dropped (no flicker)", () => {
  // Sign-in race: a Guest log line issued just before sign-in lands a
  // moment after the logged-in entry has already retired the Guest
  // row. We must NOT recreate the Guest row, otherwise the duplicate
  // appears in the dashboard for up to 5 minutes.
  clearBackgroundSessions();
  processBackgroundJournalLine(
    entryLine("192.168.1.227", "anna@example.com", "CDN_Module")
  );
  processBackgroundJournalLine(
    assetHeartbeat("192.168.1.227", "anonymous", "en-w3schools")
  );
  const snap = getLiveSessionsSnapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0]?.username, "anna@example.com");
});

test("cold-start heartbeat for a logged-in user also retires a Guest at the same IP", () => {
  // Sign-in flow can race so the first signal we see for the logged-in
  // user might be an asset heartbeat rather than an entry hit.
  clearBackgroundSessions();
  processBackgroundJournalLine(
    entryLine("192.168.1.227", "anonymous", "en-w3schools")
  );
  processBackgroundJournalLine(
    assetHeartbeat("192.168.1.227", "anna@example.com", "CDN_Module")
  );
  const snap = getLiveSessionsSnapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0]?.username, "anna@example.com");
});

test("two users on different modules each keep their own session against thumbnail fanout", () => {
  clearBackgroundSessions();
  processBackgroundJournalLine(
    entryLine("192.168.1.20", "anna@example.com", "cdn_math")
  );
  processBackgroundJournalLine(
    entryLine("192.168.1.21", "bob@example.com", "cdn_geo")
  );
  // Anna's browser fans out thumbnails — must not affect either user.
  for (const slug of ["en-bookdash", "shape", "fonts", "support-files"]) {
    processBackgroundJournalLine(
      assetHeartbeat("192.168.1.20", "anna@example.com", slug)
    );
  }
  const snap = getLiveSessionsSnapshot();
  assert.equal(snap.length, 2);
  const anna = snap.find((s) => s.username === "anna@example.com");
  const bob = snap.find((s) => s.username === "bob@example.com");
  assert.ok(anna && bob);
  assert.equal(anna.module, "cdn_math");
  assert.equal(bob.module, "cdn_geo");
});
