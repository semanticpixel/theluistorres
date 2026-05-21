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
 *   - `gh` CLI installed and logged in as the WORK GitHub account
 *     ($ gh auth login)
 *   - (Optional — only needed for GitLab) either:
 *     • `glab` CLI installed and logged in    [preferred]
 *       ($ glab auth login --hostname gitlab.com)
 *     • OR set $GITLAB_TOKEN + $GITLAB_USERNAME explicitly
 *
 * Usage:
 *   $ pnpm run sync:work
 *   $ git diff public/data/work-contributions.json
 *   $ git commit -am 'chore: sync work contributions YYYY-MM-DD' && git push
 *
 * The script is dependency-free — just node:* and the CLIs as subprocesses.
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

/* ---- GitLab ---- */
/*
 * Auth precedence:
 *   1. `glab` CLI auth (preferred — mirrors the `gh` pattern, no env vars
 *      to keep in sync). Reads the token + logged-in username from
 *      `glab auth status --show-token`.
 *   2. Env vars $GITLAB_TOKEN + $GITLAB_USERNAME (fallback for machines
 *      that don't have glab installed).
 *
 * Once we have a (token, username) pair, hit the same /users/<name>/calendar.json
 * endpoint — the heatmap GitLab renders on the profile page. Authenticated,
 * the response includes private contributions on the requested profile.
 */
function resolveGitLabAuth() {
  const env = { token: process.env.GITLAB_TOKEN, username: process.env.GITLAB_USERNAME };
  if (env.token && env.username) return { ...env, source: "env" };

  try {
    /*
     * `glab auth status --show-token` writes to stderr something like:
     *   gitlab.com
     *     ✓ Logged in to gitlab.com as <username> (oauth_token, /...config/glab-cli/config.yml)
     *     ✓ Git operations for gitlab.com configured to use https protocol.
     *     ✓ Token: glpat-xxxxxxxxxxxx
     *     ✓ Token scopes: api, read_user
     * We grep both lines and combine. If glab isn't installed or no session
     * is active, the command exits non-zero and we fall through.
     */
    const out = execFileSync(
      "glab",
      ["auth", "status", "--hostname", "gitlab.com", "--show-token"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const blob = out + ""; // status often goes to stdout in newer glab; cover both
    const userMatch = blob.match(/Logged in to \S+ as (\S+)/);
    const tokenMatch = blob.match(/Token:\s*(\S+)/);
    if (userMatch && tokenMatch) {
      return { token: tokenMatch[1], username: userMatch[1], source: "glab" };
    }
  } catch (err) {
    /* glab not installed OR not logged in OR newer glab wrote to stderr;
       try the stderr buffer before giving up. */
    const stderr = err.stderr?.toString() ?? "";
    const userMatch = stderr.match(/Logged in to \S+ as (\S+)/);
    const tokenMatch = stderr.match(/Token:\s*(\S+)/);
    if (userMatch && tokenMatch) {
      return { token: tokenMatch[1], username: userMatch[1], source: "glab" };
    }
  }

  return null;
}

async function fetchGitLab() {
  const auth = resolveGitLabAuth();
  if (!auth) {
    console.log(
      "gitlab: skipped (run `glab auth login --hostname gitlab.com` OR set GITLAB_TOKEN + GITLAB_USERNAME)",
    );
    return [];
  }

  const url = `https://gitlab.com/users/${encodeURIComponent(auth.username)}/calendar.json`;
  const res = await fetch(url, {
    headers: { "PRIVATE-TOKEN": auth.token, "user-agent": "projectluis-work-sync" },
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
  console.log(`gitlab: ${auth.username} → ${total} contributions (auth via ${auth.source})`);
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
