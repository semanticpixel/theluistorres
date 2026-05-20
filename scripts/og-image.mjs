#!/usr/bin/env node
/*
 * og-image.mjs — generate Open Graph PNGs at build time.
 *
 * For each route in `PAGES`, compose a 1200×630 image with the route's
 * title rendered in Fraunces over a layered backdrop, push it through
 * satori → resvg, write the result to `public/og/<slug>.png`. Astro's
 * `public/` copy step then picks them up into `dist/og/`.
 *
 * The PNGs are committed and tracked — generation is deterministic, so
 * checking the output into version control means PRs that change a
 * title also show a diff in the OG file (which is the easiest QA loop
 * for catching accidental regressions in OG framing).
 *
 * Add a new page: add a row to `PAGES`. Re-run `pnpm run og` (or just
 * `pnpm run build`, which calls this first).
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import wawoff from "wawoff2";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/*
 * Satori only accepts ttf/otf — the @fontsource* packages ship woff2.
 * Decompress at script start using wawoff2 (the official woff2 decoder
 * compiled to JS). Cached in memory for the run.
 */
async function ttfFromWoff2(woff2Path) {
  const woff2 = await readFile(woff2Path);
  return Buffer.from(await wawoff.decompress(woff2));
}

const PAGES = [
  { slug: "default",     title: "Luis Torres",        subtitle: "design engineer" },
  { slug: "home",        title: "Luis Torres",        subtitle: "design engineer building for the web" },
  { slug: "work",        title: "Case studies",       subtitle: "five projects · five retros" },
  { slug: "theme",       title: "Design tokens",      subtitle: "/theme · the four-mode QA surface" },
  { slug: "sandbox",     title: "Sandbox",            subtitle: "quick sketches that taught me something" },
];

/* Load Fraunces 400 (latin subset, single weight — enough for OG titles). */
const fonts = [
  {
    name: "Fraunces",
    data: await ttfFromWoff2(
      resolve(root, "node_modules/@fontsource/fraunces/files/fraunces-latin-400-normal.woff2"),
    ),
    weight: 400,
    style: "normal",
  },
];

function template({ title, subtitle }) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        width: "1200px",
        height: "630px",
        padding: "64px",
        background: "#fafaf7",       /* --bone-0 */
        color: "#1a1d20",            /* --slate-100 */
        fontFamily: "Fraunces",
        position: "relative",
      },
      children: [
        /* Terracotta accent — single chromatic signal, top-right. */
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              top: "64px",
              right: "64px",
              width: "20px",
              height: "20px",
              borderRadius: "9999px",
              background: "#c2625e",   /* --terracotta-60 */
            },
          },
        },
        /* Mono eyebrow */
        {
          type: "div",
          props: {
            style: {
              fontSize: "20px",
              letterSpacing: "0.04em",
              color: "#6f7984",        /* --slate-60 */
              marginBottom: "24px",
              textTransform: "lowercase",
            },
            children: "projectluis.com",
          },
        },
        /* Title */
        {
          type: "div",
          props: {
            style: {
              fontSize: "120px",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              maxWidth: "900px",
            },
            children: title,
          },
        },
        /* Subtitle */
        subtitle && {
          type: "div",
          props: {
            style: {
              fontSize: "32px",
              marginTop: "24px",
              color: "#6f7984",
              maxWidth: "900px",
            },
            children: subtitle,
          },
        },
      ].filter(Boolean),
    },
  };
}

async function generate(page) {
  const svg = await satori(template(page), { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  const outDir = resolve(root, "public/og");
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `${page.slug}.png`);
  await writeFile(outPath, png);
  return outPath;
}

const results = [];
for (const page of PAGES) {
  try {
    const out = await generate(page);
    results.push({ slug: page.slug, ok: true, out });
  } catch (err) {
    results.push({ slug: page.slug, ok: false, err: err.message });
  }
}

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
console.log(`og-image: ${passed}/${results.length} generated`);
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.slug} ${r.ok ? `→ ${r.out}` : `(${r.err})`}`);
}
if (failed.length > 0) process.exit(1);
