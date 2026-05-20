#!/usr/bin/env node
/*
 * fetch-contributions.mjs
 *
 * Pulls the last ~year of GitHub contribution-calendar data, optionally
 * merging two tokens (personal + work), writes `public/data/contributions.json`.
 *
 * Required env:
 *   PERSONAL_GH_TOKEN   — classic or fine-grained PAT with `read:user` scope.
 *
 * Optional env:
 *   WORK_GH_TOKEN       — same shape; daily counts get summed with personal.
 *   WORK_GH_API_URL     — GraphQL endpoint for GitHub Enterprise Server hosts
 *                         (e.g. `https://github.example.com/api/graphql`).
 *                         Defaults to github.com when only the personal token
 *                         is set; defaults per-token when both are set.
 *
 * The script is intentionally dependency-free — no @octokit, no graphql-request,
 * just `fetch`. Smaller surface, easier to read, easier to debug in CI logs.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const personalToken = process.env.PERSONAL_GH_TOKEN;
const workToken = process.env.WORK_GH_TOKEN;
const workApiUrl = process.env.WORK_GH_API_URL || "https://api.github.com/graphql";

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

/* Current streak = consecutive trailing days with count >= 1, walking backwards. */
function computeStreak(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].count > 0) streak += 1;
    else break;
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

const { from, to } = range();

const personal = await fetchCalendar({
  token: personalToken,
  apiUrl: "https://api.github.com/graphql",
  from,
  to,
});
let merged = flattenCalendar(personal);
let total = personal.totalContributions;

if (workToken) {
  const work = await fetchCalendar({ token: workToken, apiUrl: workApiUrl, from, to });
  merged = mergeMaps(merged, flattenCalendar(work));
  total += work.totalContributions;
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
    sources: workToken ? ["personal", "work"] : ["personal"],
  },
  contributions: days,
};

const dir = resolve(root, "public/data");
await mkdir(dir, { recursive: true });
await writeFile(resolve(dir, "contributions.json"), JSON.stringify(out, null, 2) + "\n");

console.log(
  `fetch-contributions: ${days.length} days · ${total} total · ${streak}-day streak · today ${today?.count ?? 0}`,
);
