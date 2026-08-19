import test from "node:test";
import assert from "node:assert/strict";
import { applyPreviewTheme } from "../lib/html-preview-theme";

test("#1 dark theme injects color-scheme:dark and dark bg/text", () => {
  const out = applyPreviewTheme("<p>hello</p>", true);
  assert.match(out, /color-scheme:\s*dark/i);
  assert.match(out, /background-color:\s*#1a1a1a/i);
  assert.match(out, /<p>hello<\/p>/);
});

test("#2 light theme injects color-scheme:light and light bg/text", () => {
  const out = applyPreviewTheme("<p>hi</p>", false);
  assert.match(out, /color-scheme:\s*light/i);
  assert.match(out, /background-color:\s*#ffffff/i);
});

test("#3 injects into existing <head> when present", () => {
  const out = applyPreviewTheme("<html><head><meta charset='utf-8'></head><body>x</body></html>", true);
  // style injected right after <head ...> (before the meta)
  assert.ok(out.indexOf("<style>") < out.indexOf("<meta"));
  assert.match(out, /<body>x<\/body>/);
});

test("#4 preserves the original content verbatim", () => {
  const src = "<div class='a'>keep me</div>";
  const out = applyPreviewTheme(src, false);
  assert.ok(out.includes("<div class='a'>keep me</div>"));
});

test("#5 theme tag appears only once", () => {
  const out = applyPreviewTheme("<p>a</p>", true);
  assert.strictEqual((out.match(/<style>/g) || []).length, 1);
});