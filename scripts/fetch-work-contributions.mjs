#!/usr/bin/env node
/*
 * fetch-work-contributions.mjs — local-only.
 *
 * Pulls last-year contribution-calendar data from the *work* GitHub account
 * (using the locally-authenticated `gh` CLI) and optionally a GitLab
 * account (via a stored PAT), writes a snapshot to
 * `public/data/work-contributions.json`.
 *
 * The sync-contributions CI workflow then merges that snapshot with the
 * personal account's API data on its next nightly run.
 *
 * Why this exists separately from the CI script:
 *   The Superhuman org gates fine-grained PATs for org-owned private repos
 *   (a common security posture). A repository-scoped service token can't
 *   see private commits, so the CI's API path can only ever return public
 *   activity. Running this script from a logged-in dev session uses the
 *   developer's own credentials — same data the user sees on github.com —
 *   without needing any third-party-style approval flow.
 *
 *   Trade-off: it doesn't auto-sync. Run it when you want to refresh the
 *   work side (weekly cadence works fine), commit, push.
 *
 * Prerequisites:
 *   - `gh` CLI installed and logged in as the WORK account
 *     ($ gh auth login)
 *   - (Optional, only if you want GitLab counts merged in)
 *     $ export GITLAB_TOKEN=<personal access token, scope `read_user`>
 *     $ export GITLAB_USERNAME=<your gitlab handle>
 *
 * Usage:
 *   $ pnpm run sync:work
 *   $ git diff public/data/work-contributions.json
 *   $ git commit -am 'chore: sync work contributions YYYY-MM-DD' && git push
 *
 * The script is dependency-free — just node:* and `gh` as a subprocess.
 */

import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const OUT_PATH = resolve(root, "public/data/work-contributions.json");

/* ---- range: last 365 days, UTC midnight aligned ---- */
function range() {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 365);
  return { from: from.toISOString(), to: to.toISOString() };
}

const { from, to } = range();

/* ---- GitHub via local `gh` CLI ---- */
async function fetchGitHub() {
  const query = `query($from:DateTime!,$to:DateTime!){viewer{login contributionsCollection(from:$from,to:$to){contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`;
  let raw;
  try {
    raw = execFileSync(
      "gh",
      ["api", "graphql", "-F", `from=${from}`, "-F", `to=${to}`, "-f", `query=${query}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    const stderr = err.stderr?.toString() ?? "";
    throw new Error(
      `gh api graphql failed: ${stderr.trim() || err.message}\n` +
      `Hint: run "gh auth status" and confirm you're logged in as the work account.`,
    );
  }

  const { data, errors } = JSON.parse(raw);
  if (errors) throw new Error(`GitHub GraphQL errors: ${JSON.stringify(errors)}`);

  const cal = data.viewer.contributionsCollection.contributionCalendar;
  const days = cal.weeks.flatMap((w) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })),
  );
  console.log(`github: ${data.viewer.login} → ${cal.totalContributions} contributions`);
  return days;
}

/* ---- GitLab via stored token ---- */
async function fetchGitLab() {
  const token = process.env.GITLAB_TOKEN;
  const username = process.env.GITLAB_USERNAME;
  if (!token || !username) {
    console.log("gitlab: skipped (set GITLAB_TOKEN + GITLAB_USERNAME to include)");
    return [];
  }

  /*
   * The /users/<name>/calendar.json endpoint returns the same heatmap GitLab
   * shows on the profile page — { "YYYY-MM-DD": count, ... }. Authenticated,
   * it includes private contributions on the requested user's profile.
   */
  const url = `https://gitlab.com/users/${encodeURIComponent(username)}/calendar.json`;
  const res = await fetch(url, {
    headers: { "PRIVATE-TOKEN": token, "user-agent": "projectluis-work-sync" },
  });
  if (!res.ok) {
    throw new Error(`gitlab: HTTP ${res.status} on ${url}`);
  }
  const cal = await res.json();

  const fromDate = from.slice(0, 10);
  const toDate = to.slice(0, 10);
  const days = Object.entries(cal)
    .filter(([date]) => date >= fromDate && date <= toDate)
    .map(([date, count]) => ({ date, count: Number(count) || 0 }));
  const total = days.reduce((s, d) => s + d.count, 0);
  console.log(`gitlab: ${username} → ${total} contributions`);
  return days;
}

/* ---- run + merge + write ---- */
const [gh, gl] = await Promise.all([fetchGitHub(), fetchGitLab()]);

const sources = [];
if (gh.length) sources.push("github");
if (gl.length) sources.push("gitlab");

const byDate = new Map();
for (const d of [...gh, ...gl]) {
  byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.count);
}
const merged = [...byDate.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([date, count]) => ({ date, count }));

const payload = {
  lastUpdated: new Date().toISOString(),
  range: { from, to },
  sources,
  totalContributions: merged.reduce((s, d) => s + d.count, 0),
  contributions: merged,
};

await mkdir(dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
console.log(
  `\nWrote ${OUT_PATH.replace(root + "/", "")}` +
  ` → ${payload.totalContributions} contributions across ${merged.length} days from ${sources.join(" + ")}.`,
);
console.log("Next: git diff public/data/work-contributions.json, then commit + push when you're happy with it.");
