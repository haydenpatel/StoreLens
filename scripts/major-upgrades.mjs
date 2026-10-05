#!/usr/bin/env node
// Opens one GitHub issue per major-version upgrade of a direct dependency.
// Dependabot only opens PRs, and a major bump can need code changes, so
// .github/dependabot.yml ignores majors and this script (run monthly by
// .github/workflows/major-upgrades.yml) raises them as issues to plan instead.
//
//   node scripts/major-upgrades.mjs [--dry-run]
//
// Needs `npm` and an authenticated `gh` (GH_TOKEN) on PATH. No `npm ci`:
// `npm outdated` reads package.json and the registry, so nothing is installed
// or run. An upgrade is skipped if any issue (open or closed) already has its
// title, so a second run creates nothing new.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Packages that must move together share one issue.
export const GROUPS = [
  ["vite", "@vitejs/plugin-react"],
  ["eslint", "@eslint/js"],
];

// @types/node should follow the Node version the project runs (22), not npm's latest.
export const EXCLUDED = new Set(["@types/node"]);

export const LABELS = ["chore", "priority: low"];

// First number in a range: "^0.554.0" -> 0, "~7.2.2" -> 7, ">=9" -> 9.
export function rangeMajor(range) {
  const match = /\d+/.exec(range);
  return match ? Number(match[0]) : null;
}

// "git+https://github.com/vitejs/vite.git" -> "https://github.com/vitejs/vite/releases".
// Anything that isn't a GitHub repo falls back to the package's npm page.
export function releasesUrl(repositoryUrl, name) {
  const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(repositoryUrl ?? "");
  return match
    ? `https://github.com/${match[1]}/releases`
    : `https://www.npmjs.com/package/${name}`;
}

// pkg: parsed package.json. outdated: parsed `npm outdated --json`.
// Returns [{ title, upgrades: [{ name, range, latest }] }], one per issue.
export function findMajorUpgrades(pkg, outdated) {
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const majors = new Map();
  for (const [name, range] of Object.entries(declared)) {
    const latest = outdated[name]?.latest;
    if (EXCLUDED.has(name) || !latest) continue;
    const from = rangeMajor(range);
    const to = Number.parseInt(latest, 10);
    if (from !== null && to > from) majors.set(name, { name, range, latest });
  }

  const upgrades = [];
  const grouped = new Set(GROUPS.flat());
  for (const group of GROUPS) {
    const members = group.filter((name) => majors.has(name)).map((name) => majors.get(name));
    if (members.length) upgrades.push(members);
  }
  for (const [name, upgrade] of majors) {
    if (!grouped.has(name)) upgrades.push([upgrade]);
  }

  return upgrades.map((members) => ({
    title: `Upgrade ${members[0].name} to v${Number.parseInt(members[0].latest, 10)}`,
    upgrades: members,
  }));
}

export function issueBody(upgrades, links) {
  const lines = upgrades.map(
    ({ name, range, latest }) =>
      `- \`${name}\`: \`${range}\` → \`${latest}\` ([release notes](${links[name]}))`,
  );
  const together =
    upgrades.length > 1 ? "\n\nThese packages need to move together, so they share this issue." : "";
  return [
    "A new major version is available for a direct dependency. Dependabot does not open PRs for major versions, so this issue tracks the upgrade.",
    "",
    ...lines,
    together,
    "",
    "Check the release notes for breaking changes, then upgrade, and run lint, tests and a build.",
    "",
    "_Opened by the monthly Major upgrades workflow._",
  ].join("\n");
}

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// `npm outdated` exits 1 whenever anything is outdated; the JSON is still on stdout.
function npmOutdated() {
  try {
    return JSON.parse(run("npm", ["outdated", "--json"]) || "{}");
  } catch (error) {
    if (error.status === 1 && error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

function linkFor(name) {
  try {
    return releasesUrl(run("npm", ["view", name, "repository.url"]).trim(), name);
  } catch {
    return releasesUrl(null, name);
  }
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const found = findMajorUpgrades(pkg, npmOutdated());

  const existing = new Set(
    JSON.parse(
      run("gh", ["issue", "list", "--state", "all", "--limit", "1000", "--json", "title"]),
    ).map((issue) => issue.title),
  );

  for (const { title, upgrades } of found) {
    if (existing.has(title)) {
      console.log(`exists   ${title}`);
      continue;
    }
    if (dryRun) {
      console.log(`would open  ${title}`);
      continue;
    }
    const links = Object.fromEntries(upgrades.map(({ name }) => [name, linkFor(name)]));
    const args = ["issue", "create", "--title", title, "--body", issueBody(upgrades, links)];
    for (const label of LABELS) args.push("--label", label);
    console.log(`opened   ${title}  ${run("gh", args).trim()}`);
  }
  if (!found.length) console.log("No major upgrades available.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
