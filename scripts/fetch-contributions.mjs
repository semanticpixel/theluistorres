#!/usr/bin/env node
/*
 * fetch-contributions.mjs
 *
 * Pulls the last ~year of GitHub contribution-calendar data for the
 * personal account, optionally merges in a manually-committed snapshot
 * of work contributions, writes `public/data/contributions.json`.
 *
 * Required env:
 *   PERSONAL_GH_TOKEN   — classic or fine-grained PAT with `read:user`
 *                         (classic) or appropriate fine-grained scope.
 *
 * Optional input:
 *   public/data/work-contributions.json — written by
 *     `scripts/fetch-work-contributions.mjs` (a local-only sync that uses
 *     the developer's logged-in `gh` CLI session to pull work-GH + GitLab
 *     contributions). If present, its daily counts get summed in here.
 *     The file isn't read from secrets; it's just committed alongside the
 *     code on whatever cadence makes sense — see that script's header
 *     for the rationale.
 *
 * The script is intentionally dependency-free — no @octokit, no graphql-request,
 * just `fetch`. Smaller surface, easier to read, easier to debug in CI logs.
 */

import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const personalToken = process.env.PERSONAL_GH_TOKEN;

if (!personalToken) {
  console.error("fetch-contributions: PERSONAL_GH_TOKEN is required.");
  process.exit(1);
}

/* Computes [from, to] for the last 365 days, ISO timestamps, UTC midnight aligned. */
function range() {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 365);
  return { from: from.toISOString(), to: to.toISOString() };
}

const QUERY = `
  query ContributionCalendar($from: DateTime!, $to: DateTime!) {
    viewer {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              contributionLevel
            }
          }
        }
      }
    }
  }
`;

const LEVEL = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

async function fetchCalendar({ token, apiUrl, from, to }) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "projectluis.com-contributions-sync",
    },
    body: JSON.stringify({ query: QUERY, variables: { from, to } }),
  });
  if (!res.ok) {
    throw new Error(`${apiUrl} → HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`${apiUrl} → GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data.viewer.contributionsCollection.contributionCalendar;
}

/* Re-derive level buckets after summing — simple percentile over non-zero days. */
function rebucketLevels(days) {
  const counts = days.map(d => d.count).filter(c => c > 0).sort((a, b) => a - b);
  if (counts.length === 0) return days.map(d => ({ ...d, level: 0 }));
  const q1 = counts[Math.floor(counts.length * 0.25)];
  const q2 = counts[Math.floor(counts.length * 0.5)];
  const q3 = counts[Math.floor(counts.length * 0.75)];
  return days.map(d => {
    if (d.count === 0) return { ...d, level: 0 };
    if (d.count <= q1) return { ...d, level: 1 };
    if (d.count <= q2) return { ...d, level: 2 };
    if (d.count <= q3) return { ...d, level: 3 };
    return { ...d, level: 4 };
  });
}

/*
 * Current streak = consecutive trailing days with count >= 1, walking
 * backwards from the latest day in the range.
 *
 * One exception: if *today* has 0 commits, don't treat that as a streak
 * break — the workflow runs at 08:00 UTC (and ad-hoc dispatches can run
 * any time), so "no commits yet today" is the normal state for most of
 * a working day. We skip the trailing zero if and only if it's today,
 * then count consecutive non-zero days from yesterday backwards. If
 * yesterday is also zero, the streak is genuinely 0.
 */
function computeStreak(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return 0;

  let i = sorted.length - 1;
  if (sorted[i].count === 0) i -= 1;

  let streak = 0;
  while (i >= 0 && sorted[i].count > 0) {
    streak += 1;
    i -= 1;
  }
  return streak;
}

function flattenCalendar(cal) {
  /* Returns Map<date, { date, count, level }>. */
  const out = new Map();
  for (const week of cal.weeks) {
    for (const day of week.contributionDays) {
      out.set(day.date, {
        date: day.date,
        count: day.contributionCount,
        level: LEVEL[day.contributionLevel] ?? 0,
      });
    }
  }
  return out;
}

function mergeMaps(a, b) {
  const out = new Map(a);
  for (const [date, day] of b) {
    if (out.has(date)) {
      const prev = out.get(date);
      out.set(date, { date, count: prev.count + day.count, level: 0 /* rebucketed below */ });
    } else {
      out.set(date, day);
    }
  }
  return out;
}

/*
 * Optional work snapshot: a JSON file committed by hand from a local run
 * of fetch-work-contributions.mjs. Shape:
 *   {
 *     "lastUpdated": "...",
 *     "range": { "from": "...", "to": "..." },
 *     "sources": ["github", "gitlab"],
 *     "totalContributions": <n>,
 *     "contributions": [{ "date": "YYYY-MM-DD", "count": <n> }, ...]
 *   }
 * Dates outside the personal sync's window are dropped silently.
 */
async function readWorkSnapshot() {
  const path = resolve(root, "public/data/work-contributions.json");
  try {
    await stat(path);
  } catch {
    return null;
  }
  try {
    const raw = await readFile(path, "utf8");
    const json = JSON.parse(raw);
    if (!Array.isArray(json.contributions)) return null;
    return json;
  } catch (err) {
    console.warn(`fetch-contributions: ignoring unreadable ${path}: ${err.message}`);
    return null;
  }
}

const { from, to } = range();

const personal = await fetchCalendar({
  token: personalToken,
  apiUrl: "https://api.github.com/graphql",
  from,
  to,
});
let merged = flattenCalendar(personal);
let total = personal.totalContributions;

const workSnapshot = await readWorkSnapshot();
const sources = ["personal"];
if (workSnapshot) {
  const workMap = new Map();
  for (const d of workSnapshot.contributions) {
    /* Drop days outside our sync window so the level percentile bucketing
       only sees comparable timestamps. */
    if (d.date >= from.slice(0, 10) && d.date <= to.slice(0, 10)) {
      workMap.set(d.date, { date: d.date, count: d.count, level: 0 });
    }
  }
  merged = mergeMaps(merged, workMap);
  total += [...workMap.values()].reduce((s, d) => s + d.count, 0);
  for (const src of workSnapshot.sources ?? []) {
    if (!sources.includes(src)) sources.push(src);
  }
}

const days = rebucketLevels([...merged.values()].sort((a, b) => a.date.localeCompare(b.date)));
const streak = computeStreak(days);
const today = days[days.length - 1];

const out = {
  lastUpdated: new Date().toISOString(),
  meta: {
    totalContributions: total,
    streak,
    todayCount: today?.count ?? 0,
    range: { from, to },
    sources,
  },
  contributions: days,
};

const dir = resolve(root, "public/data");
await mkdir(dir, { recursive: true });
await writeFile(resolve(dir, "contributions.json"), JSON.stringify(out, null, 2) + "\n");

console.log(
  `fetch-contributions: ${days.length} days · ${total} total · ${streak}-day streak · today ${today?.count ?? 0} · sources=${sources.join("+")}`,
);
