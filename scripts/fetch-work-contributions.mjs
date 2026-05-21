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
 *       ($ glab auth login --hostname <your-gitlab-host>)
 *       The host is auto-discovered from `glab auth status` — works for
 *       gitlab.com AND self-hosted instances with zero config.
 *     • OR set $GITLAB_TOKEN + $GITLAB_USERNAME explicitly. In that case
 *       set $GITLAB_HOST too (defaults to gitlab.com).
 *
 * Usage:
 *   $ pnpm run sync:work
 *   $ git diff public/data/work-contributions.json
 *   $ git commit -am 'chore: sync work contributions YYYY-MM-DD' && git push
 *
 * The script is dependency-free — just node:* and the CLIs as subprocesses.
 */

import { execFileSync, spawnSync } from "node:child_process";
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
 *   1. Env vars $GITLAB_TOKEN + $GITLAB_USERNAME (+ optional $GITLAB_HOST,
 *      default gitlab.com). For CI or machines without glab.
 *   2. `glab` CLI auth (preferred for local dev — mirrors the `gh` pattern,
 *      no env vars to keep in sync). The host is auto-discovered from the
 *      `REST API Endpoint:` line in `glab auth status` output, so it works
 *      transparently for both gitlab.com and self-hosted instances.
 *
 * Once we have (host, token, username), hit /api/v4/events filtered by
 * date. Push events contribute their commit_count; everything else (MR,
 * issue, comment, review) counts as 1 — matches the heatmap's intuition.
 */
function resolveGitLabAuth() {
  if (process.env.GITLAB_TOKEN && process.env.GITLAB_USERNAME) {
    return {
      host: process.env.GITLAB_HOST ?? "gitlab.com",
      token: process.env.GITLAB_TOKEN,
      username: process.env.GITLAB_USERNAME,
      source: "env",
    };
  }

  /*
   * `glab auth status --show-token` writes to *stderr* (even on success,
   * exit 0) something like:
   *   gitlab.com
   *     ✓ Logged in to gitlab.com as <username> (/...config/glab-cli/config.yml)
   *     ✓ REST API Endpoint: https://gitlab.com/api/v4/
   *     ✓ Token found: glpat-xxxxxxxxxxxx
   * Older versions used "Token:" instead of "Token found:" and sometimes
   * wrote to stdout. We use spawnSync so we can read both streams and
   * tolerate either format.
   *
   * The host comes from the REST API Endpoint line — this is what the API
   * actually answers on, even when glab profiles use an SSH alias hostname
   * (e.g. `ssh.gitlab.grammarly.io` glab profile pointing at REST endpoint
   * `gitlab.grammarly.io`). Falls back to the "Logged in to" host if no
   * REST endpoint is printed (older glab).
   */
  const result = spawnSync("glab", ["auth", "status", "--show-token"], { encoding: "utf8" });
  if (result.error) return null; // glab not installed
  const blob = (result.stdout ?? "") + (result.stderr ?? "");
  const loginMatch = blob.match(/Logged in to (\S+) as (\S+)/);
  const tokenMatch = blob.match(/Token(?:\s+found)?:\s*(\S+)/);
  const restMatch = blob.match(/REST API Endpoint:\s+https?:\/\/([^/\s]+)/);
  if (loginMatch && tokenMatch) {
    return {
      host: restMatch?.[1] ?? loginMatch[1],
      token: tokenMatch[1],
      username: loginMatch[2],
      source: "glab",
    };
  }

  return null;
}

async function fetchGitLab() {
  const auth = resolveGitLabAuth();
  if (!auth) {
    console.log(
      "gitlab: skipped (run `glab auth login --hostname <your-gitlab-host>` OR set GITLAB_TOKEN + GITLAB_USERNAME)",
    );
    return [];
  }

  /*
   * We use /api/v4/events instead of the public /users/<name>/calendar.json.
   * Reason: calendar.json is a browser-session endpoint — on self-hosted
   * instances (e.g. gitlab.grammarly.io) it 302-redirects to /users/sign_in
   * even with a valid PRIVATE-TOKEN. The events REST endpoint honors the
   * token on both gitlab.com and self-hosted, returning every event the
   * authenticated user can see — including private project activity.
   *
   * Heatmap-equivalent counting: push events contribute commit_count
   * (a push of 3 commits = 3 contributions); other events (MR opened,
   * issue closed, comment, etc.) each count as 1.
   */
  const headers = { "PRIVATE-TOKEN": auth.token, "user-agent": "projectluis-work-sync" };
  const counts = new Map();
  let page = 1;
  for (;;) {
    const url = `https://${auth.host}/api/v4/events?per_page=100&page=${page}&after=${from.slice(0, 10)}&before=${to.slice(0, 10)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`gitlab: HTTP ${res.status} on ${url}`);
    const events = await res.json();
    if (!Array.isArray(events) || events.length === 0) break;
    for (const e of events) {
      const date = e.created_at?.slice(0, 10);
      if (!date) continue;
      const delta = e.push_data?.commit_count ?? 1;
      counts.set(date, (counts.get(date) ?? 0) + delta);
    }
    const next = res.headers.get("x-next-page");
    if (!next) break;
    page = Number(next);
  }

  const days = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
  const total = days.reduce((s, d) => s + d.count, 0);
  console.log(`gitlab: ${auth.username}@${auth.host} → ${total} contributions (auth via ${auth.source})`);
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
