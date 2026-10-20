// Runs on `npm install` (the "prepare" script): copies the versioned hooks in
// .githooks into git's hooks folder, so every clone gets the guard against
// committing on main. That folder is shared by all worktrees, so the guard
// holds even in a checkout that predates .githooks. Does nothing where this
// isn't the root of a git checkout (e.g. a deploy build without .git).
//
// Safety rules:
// - It never fails `npm install`: any error prints a warning and exits 0.
// - Hooks are ours only if they carry the MARKER line (or match a legacy
//   header from before the marker existed). A same-named hook that isn't
//   ours is left in place with a warning.
// - Hooks we installed earlier that .githooks no longer has are removed.
// - Decision on refreshing from the current branch: kept as is. Main and work
//   branches carry the same hooks, so installing from whichever branch is
//   checked out is harmless in practice, and tracking a "canonical" branch
//   would need git plumbing for no real gain.
import { execFileSync } from "node:child_process";
import os from "node:os";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync,
} from "node:fs";
import path from "node:path";

const MARKER = "storelens-managed-hook";
// First comment lines of the hooks as installed before the marker existed.
const LEGACY = [
  "#!/bin/sh\n# Local guard: work happens on issue branches in worktrees",
  "#!/bin/sh\n# A merge (e.g. a pull on a diverged main) commits without running",
];

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const warn = (msg) => console.warn(`install-hooks: ${msg}`);
const isOurs = (file) => {
  const text = readFileSync(file, "utf8");
  return text.includes(MARKER) || LEGACY.some((s) => text.startsWith(s));
};

try {
  let hooksDir;
  try {
    // Only this project's own repo, not some parent repo it happens to sit in.
    if (realpathSync(git("rev-parse", "--show-toplevel")) !== realpathSync(process.cwd())) process.exit(0);
    hooksDir = path.resolve(git("rev-parse", "--git-common-dir"), "hooks");
  } catch {
    process.exit(0); // not a git checkout, or git isn't installed
  }

  const source = path.resolve(".githooks");
  if (!existsSync(source)) {
    warn("no .githooks folder here, so no hooks were installed.");
    process.exit(0);
  }
  const names = readdirSync(source);
  mkdirSync(hooksDir, { recursive: true });

  for (const name of names) {
    try {
      const dest = path.join(hooksDir, name);
      if (existsSync(dest) && !isOurs(dest)) {
        warn(`${dest} already exists and isn't a StoreLens hook; leaving it in place, so the main-branch guard is not active for ${name}.`);
        continue;
      }
      copyFileSync(path.join(source, name), dest);
      chmodSync(dest, 0o755);
    } catch (err) {
      warn(`couldn't install ${name}: ${err.message}`);
    }
  }

  // Remove hooks we installed earlier that .githooks no longer carries.
  try {
    for (const name of readdirSync(hooksDir)) {
      if (names.includes(name) || name.endsWith(".sample")) continue;
      const file = path.join(hooksDir, name);
      try {
        if (readFileSync(file, "utf8").includes(MARKER)) unlinkSync(file);
      } catch {
        /* unreadable or a directory: not ours to touch */
      }
    }
  } catch (err) {
    warn(`couldn't clean up old hooks: ${err.message}`);
  }

  try {
    const custom = git("config", "--get", "core.hooksPath");
    // Git resolves a relative path from the checkout root, and expands a leading ~/.
    const expanded = custom.startsWith("~/") ? path.join(os.homedir(), custom.slice(2)) : custom;
    const resolved = path.resolve(expanded);
    const same = (a, b) => {
      try {
        return realpathSync(a) === realpathSync(b);
      } catch {
        return path.resolve(a) === path.resolve(b);
      }
    };
    // Pointing at the shared hooks folder or at .githooks itself is fine: the hooks run.
    if (!same(resolved, hooksDir) && !same(resolved, source)) {
      warn(`core.hooksPath is set to "${custom}", so git runs the hooks from there, not from ${hooksDir}, and the main-branch guard is not active unless that folder has the StoreLens hooks.`);
    }
  } catch {
    /* not set: git uses the hooks folder */
  }
} catch (err) {
  warn(`skipped: ${err.message}`);
}
process.exit(0);
