#!/usr/bin/env node
// Opens one GitHub issue per major-version upgrade of a direct dependency.
// Dependabot only opens PRs, and a major bump can need code changes, so
// .github/dependabot.yml ignores majors and this script (run monthly by
// .github/workflows/major-upgrades.yml) raises them as issues to plan instead.
//
//   node scripts/major-upgrades.mjs [--dry-run]
//
// Needs `npm` and an authenticated `gh` (GH_TOKEN) on PATH. No `npm ci`:
// it asks the registry for each direct dependency's latest version, so nothing
// is installed or run. An upgrade is skipped if any issue (open or closed)
// already has its title, so a second run creates nothing new.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Packages that must move together share one issue.
export const GROUPS = [
  ["vite", "@vitejs/plugin-react"],
  ["eslint", "@eslint/js"],
  ["react", "react-dom", "@types/react", "@types/react-dom"],
  ["tailwindcss", "@tailwindcss/vite"],
  ["@testing-library/react", "@testing-library/dom"],
];

// @types/node should follow the Node version the project runs (22), not npm's latest.
export const EXCLUDED = new Set(["@types/node"]);

export const LABELS = ["chore", "priority: low"];

export const MILESTONE = "Toolchain upgrades";

// The milestone to put new issues in: the open one titled `title`, or null.
// milestones: parsed `gh api repos/{owner}/{repo}/milestones` (open only by default).
export function findMilestone(milestones, title = MILESTONE) {
  return milestones.find((m) => m.title === title && m.state === "open")?.title ?? null;
}

// Looks the milestone up through `runFn(command, args)`. A failed fetch must not
// stop issues being opened, so it warns with the error and returns null.
export function loadMilestone(runFn, warn = console.warn) {
  try {
    return findMilestone(
      JSON.parse(runFn("gh", ["api", "repos/{owner}/{repo}/milestones?state=open&per_page=100"])),
    );
  } catch (error) {
    warn(`warning: could not look up milestones (${error.message}); opening issues without one`);
    return null;
  }
}

// Highest major a range allows, from the first number of each version in it:
// "^0.554.0" -> 0, "~7.2.2" -> 7, "^18 || ^19" -> 19, ">=1.2 <3" -> 3.
export function rangeMajor(range) {
  const majors = [...range.matchAll(/(?<![\d.])\d+/g)].map((match) => Number(match[0]));
  return majors.length ? Math.max(...majors) : null;
}

// "git+https://github.com/vitejs/vite.git" -> "https://github.com/vitejs/vite/releases".
// Anything that isn't a GitHub repo falls back to the package's npm page.
export function releasesUrl(repositoryUrl, name) {
  // Only plain owner/repo characters go into the link: the URL comes from the registry
  // and ends up in markdown, so anything else falls back to the npm page.
  const match = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(repositoryUrl ?? "");
  return match
    ? `https://github.com/${match[1]}/releases`
    : `https://www.npmjs.com/package/${name}`;
}

// pkg: parsed package.json. latest: { name: { latest } } from the registry.
// Returns [{ title, upgrades: [{ name, range, latest }] }], one per issue.
export function findMajorUpgrades(pkg, latest) {
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const majors = new Map();
  for (const [name, range] of Object.entries(declared)) {
    const latestVersion = latest[name]?.latest;
    if (EXCLUDED.has(name) || !latestVersion) continue;
    const from = rangeMajor(range);
    const to = Number.parseInt(latestVersion, 10);
    if (from !== null && to > from) majors.set(name, { name, range, latest: latestVersion });
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
    upgrades.length > 1 ? ["", "These packages need to move together, so they share this issue."] : [];
  return [
    "A new major version is available for a direct dependency. Dependabot does not open PRs for major versions, so this issue tracks the upgrade.",
    "",
    ...lines,
    ...together,
    "",
    "Check the release notes for breaking changes, then upgrade, and run lint, tests and a build.",
    "",
    "_Opened by the monthly Major upgrades workflow._",
  ].join("\n");
}

// Every npm/gh call gets a timeout so a hung registry can't hold the workflow for hours.
const RUN_TIMEOUT_MS = 60_000;

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: RUN_TIMEOUT_MS });
}

// Latest published version of every direct dependency, as { name: { latest } }.
// Asks the registry directly: `npm outdated` omits a package whose installed or
// locked version is already the newest its range allows, so on a clean checkout
// it never reports a newer major for an up-to-date package.
function latestVersions(pkg) {
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  return Object.fromEntries(
    names
      .filter((name) => !EXCLUDED.has(name))
      .map((name) => [name, { latest: run("npm", ["view", name, "version"]).trim() }]),
  );
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
  const found = findMajorUpgrades(pkg, latestVersions(pkg));

  const existing = new Set(
    JSON.parse(
      run("gh", ["issue", "list", "--state", "all", "--limit", "1000", "--json", "title"]),
    ).map((issue) => issue.title),
  );

  const toOpen = found.filter(({ title }) => !existing.has(title));
  const milestone = toOpen.length ? loadMilestone(run) : null;
  if (toOpen.length && !milestone) {
    console.warn(`warning: no open milestone titled "${MILESTONE}"; opening issues without one`);
  } else if (milestone && dryRun) {
    console.log(`milestone  ${milestone}`);
  }

  for (const { title, upgrades } of found) {
    if (existing.has(title)) {
      console.log(`exists   ${title}`);
      continue;
    }
    if (dryRun) {
      console.log(`would open  ${title}  (milestone: ${milestone ?? "none"})`);
      continue;
    }
    const links = Object.fromEntries(upgrades.map(({ name }) => [name, linkFor(name)]));
    const args = ["issue", "create", "--title", title, "--body", issueBody(upgrades, links)];
    for (const label of LABELS) args.push("--label", label);
    if (milestone) args.push("--milestone", milestone);
    console.log(`opened   ${title}  ${run("gh", args).trim()}`);
  }
  if (!found.length) console.log("No major upgrades available.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
