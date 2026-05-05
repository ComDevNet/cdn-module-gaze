import test from "node:test";
import assert from "node:assert/strict";
import {
  extractModuleIdFromPath,
  preferStableModuleSegment,
} from "@/lib/modulePath";

// ---------------------------------------------------------------------------
// Regression tests for the "phantom moduleId" bug observed in production
// logs on 192.168.1.92 (modulegaze-sessions.log accumulating slugs like
// `img`, `asset`, `asse`, `style`). Root cause: the parser walked past
// the slug into asset/sub-page directory names and then picked the LAST
// stable segment as the module id. The right answer is always the FIRST
// stable segment under `/(uploads/)?modules/`.
// ---------------------------------------------------------------------------

test("/uploads/modules/<build>/<slug>/index.html → <slug>", () => {
  assert.equal(
    extractModuleIdFromPath(
      "/uploads/modules/1763333740231_qw83ospc0/BookBridge/index.html"
    ),
    "BookBridge"
  );
});

test("/modules/<build>/<slug>/index.html → <slug>", () => {
  assert.equal(
    extractModuleIdFromPath(
      "/modules/1763391338325_iyefn8g94/en-wassce/index.html"
    ),
    "en-wassce"
  );
});

test("asset URL under <slug>/img/ — must be <slug>, not 'img' (production bug)", () => {
  assert.equal(
    extractModuleIdFromPath(
      "/modules/1763351385580_za0yw3hws/en-ebooks/img/big-book.jpg"
    ),
    "en-ebooks",
    "Logs on 192.168.1.92 had moduleId=img persisted because the parser " +
      "walked into /img/ then returned the last stable segment."
  );
});

test("asset URL under <slug>/asset/ — must be <slug>, not 'asset' (production bug)", () => {
  assert.equal(
    extractModuleIdFromPath(
      "/modules/1777676510110_f6iy7ii71/the-cultural-and-occult-symbiosis-of-witches-and-black-cats/assets/web/foo.css"
    ),
    "the-cultural-and-occult-symbiosis-of-witches-and-black-cats"
  );
});

test("sub-page navigation <slug>/<sub>/index.html — must still be <slug>", () => {
  assert.equal(
    extractModuleIdFromPath(
      "/modules/1763351385580_za0yw3hws/en-ebooks/img/index.html"
    ),
    "en-ebooks",
    "User clicking into a sub-page of the module is still in <slug>; the " +
      "sub-folder name must not become the moduleId."
  );
});

test("asset URL under <slug>/style/ — must be <slug>, not 'style'", () => {
  assert.equal(
    extractModuleIdFromPath(
      "/modules/1763333740231_qw83ospc0/cdn_algebra/style/main.css"
    ),
    "cdn_algebra"
  );
});

test("legacy /modules/<slug>/index.html (no build id) → <slug>", () => {
  assert.equal(
    extractModuleIdFromPath("/modules/cdn_verbs/content/index.html"),
    "cdn_verbs"
  );
});

test("legacy /modules/<slug>/img/foo.jpg (no build id) → <slug>", () => {
  assert.equal(
    extractModuleIdFromPath("/modules/cdn_verbs/img/foo.jpg"),
    "cdn_verbs"
  );
});

test("URL-encoded slug with spaces is decoded", () => {
  assert.equal(
    extractModuleIdFromPath(
      "/uploads/modules/1763333740231_qw83ospc0/CDN%20Module%20-%20Single%20Page%20-%20With%20Images/index.html"
    ),
    "CDN Module - Single Page - With Images"
  );
});

test("non-module path returns null", () => {
  assert.equal(extractModuleIdFromPath("/api/health-check/prisma"), null);
  assert.equal(extractModuleIdFromPath("/_next/static/chunks/abc.js"), null);
  assert.equal(extractModuleIdFromPath("/img/logo.png"), null);
});

test("preferStableModuleSegment picks the FIRST stable, not the last", () => {
  // Direct unit test for the helper. With the previous `last` semantics,
  // ["<slug>", "img"] would return "img"; now it returns "<slug>".
  assert.equal(
    preferStableModuleSegment(["en-ebooks", "img"]),
    "en-ebooks"
  );
  assert.equal(
    preferStableModuleSegment([
      "1763391338325_iyefn8g94",
      "en-wassce",
    ]),
    "en-wassce",
    "Build id is dynamic and must be filtered out before picking the slug."
  );
  assert.equal(preferStableModuleSegment([]), null);
});
