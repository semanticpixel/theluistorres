#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DIST = "./dist";
const HOME = join(DIST, "index.html");
const CSS_BUDGET = 12 * 1024;
const JS_BUDGET = 8 * 1024;

if (!existsSync(HOME)) {
  console.error(`bundle-size: ${HOME} not found — run 'pnpm run build' first.`);
  process.exit(2);
}

const html = await readFile(HOME, "utf-8");

const inlineStyles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1])
  .filter(s => s.trim().length > 0);

const cssRefs = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)].map(m => m[1]);
const jsRefs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);

const isExternal = url => /^(https?:)?\/\//.test(url);

const sumGzip = arr => arr.reduce((acc, s) => acc + gzipSync(Buffer.from(s, "utf-8")).length, 0);

const inlineCssGz = sumGzip(inlineStyles);
const inlineJsGz = sumGzip(inlineScripts);

let externalCssGz = 0;
for (const ref of cssRefs) {
  if (isExternal(ref)) continue;
  const path = join(DIST, ref.replace(/^\//, ""));
  if (!existsSync(path)) continue;
  externalCssGz += gzipSync(await readFile(path)).length;
}

let externalJsGz = 0;
for (const ref of jsRefs) {
  if (isExternal(ref)) continue;
  const path = join(DIST, ref.replace(/^\//, ""));
  if (!existsSync(path)) continue;
  externalJsGz += gzipSync(await readFile(path)).length;
}

const totalCss = inlineCssGz + externalCssGz;
const totalJs = inlineJsGz + externalJsGz;

const fmt = b => `${(b / 1024).toFixed(2)}KB`;
const fmtBudget = b => `${(b / 1024).toFixed(0)}KB`;

console.log("");
console.log("home page (/) bundle size — gzip:");
console.log(`  CSS  ${fmt(totalCss).padStart(8)}  / budget ${fmtBudget(CSS_BUDGET)}  (inline ${fmt(inlineCssGz)} + external ${fmt(externalCssGz)})`);
console.log(`  JS   ${fmt(totalJs).padStart(8)}  / budget ${fmtBudget(JS_BUDGET)}  (inline ${fmt(inlineJsGz)} + external ${fmt(externalJsGz)})`);
console.log("");

let failed = false;
if (totalCss > CSS_BUDGET) {
  console.error(`✗ home CSS exceeds ${fmtBudget(CSS_BUDGET)} gzipped (${fmt(totalCss)})`);
  failed = true;
}
if (totalJs > JS_BUDGET) {
  console.error(`✗ home JS exceeds ${fmtBudget(JS_BUDGET)} gzipped (${fmt(totalJs)})`);
  failed = true;
}

if (failed) process.exit(1);
console.log("✓ within budget");
