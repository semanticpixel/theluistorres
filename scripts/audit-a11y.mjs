#!/usr/bin/env node
/*
 * A11y audit runner — boots `astro preview` against the built dist/, walks
 * every public route with Playwright + axe-core (light AND dark color
 * schemes), and exits non-zero on any WCAG-tagged violation.
 *
 * Why this exists alongside Lighthouse CI: Lighthouse's a11y category bundles
 * many checks under a single 0.98 floor and is partial about color-contrast
 * (it samples). axe-core enumerates every offending node — useful for
 * catching specific regressions (e.g. a low-contrast token on one card type)
 * that wouldn't drop the aggregate score under the Lighthouse threshold.
 *
 * Runs locally with:  pnpm run build && pnpm run audit:a11y
 * Runs in CI:         ./.github/workflows/ci.yml — a11y job, after build.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const PORT = 4322;
const BASE = `http://localhost:${PORT}`;
const OUT = "tmp/a11y";

/* Every public surface. Add new routes here as they ship. */
const ROUTES = [
  "/",
  "/about",
  "/work",
  "/work/linkedin-coach",
  "/work/linkedin-dark-mode",
  "/work/linkedin-design-system",
  "/work/grammarly-ai-detector",
  "/work/superhuman-com",
  "/writing",
  "/colophon",
  "/sandbox",
  "/sandbox/token-scale",
  "/sandbox/motion-lab",
  "/theme",
  "/404",
  "/es",
  "/es/about",
  "/es/work",
  "/es/work/linkedin-coach",
  "/es/work/superhuman-com",
  "/es/colophon",
];

async function startPreview() {
  const proc = spawn("pnpm", ["exec", "astro", "preview", "--port", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return proc;
    } catch { /* not up yet */ }
    await wait(500);
  }
  proc.kill();
  throw new Error(`Preview server never became ready on ${BASE}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  console.log("Booting preview server…");
  const server = await startPreview();
  console.log(`Server up at ${BASE}\n`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const summary = { light: {}, dark: {} };
  let total = 0;

  try {
    for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme,
      });
      const page = await ctx.newPage();

      for (const route of ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        total += results.violations.length;
        summary[colorScheme][route] = results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          help: v.help,
          targets: v.nodes.slice(0, 3).map((n) => n.target.join(" / ")),
        }));
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }

  await writeFile(`${OUT}/axe-summary.json`, JSON.stringify(summary, null, 2));

  console.log("=== AXE A11Y AUDIT ===");
  for (const scheme of Object.keys(summary)) {
    console.log(`\n[${scheme} mode]`);
    for (const route of ROUTES) {
      const v = summary[scheme][route] ?? [];
      if (v.length === 0) {
        console.log(`  ✅ ${route}`);
      } else {
        console.log(`  ❌ ${route} — ${v.length} violation${v.length === 1 ? "" : "s"}`);
        for (const item of v) {
          console.log(`        · [${item.impact}] ${item.id} (${item.nodes}× — ${item.help})`);
          if (item.targets[0]) console.log(`            → ${item.targets[0]}`);
        }
      }
    }
  }
  console.log(`\nTotal violations: ${total}`);

  if (total > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
