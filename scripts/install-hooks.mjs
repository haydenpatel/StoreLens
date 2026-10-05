// Runs on `npm install` (the "prepare" script): copies the versioned hooks in
// .githooks into git's hooks folder, so every clone gets the guard against
// committing on main. That folder is shared by all worktrees, so the guard
// holds even in a checkout that predates .githooks. Does nothing where this
// isn't the root of a git checkout (e.g. a deploy build without .git).
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

let hooksDir;
try {
  // Only this project's own repo, not some parent repo it happens to sit in.
  if (realpathSync(git("rev-parse", "--show-toplevel")) !== realpathSync(process.cwd())) process.exit(0);
  hooksDir = path.resolve(git("rev-parse", "--git-common-dir"), "hooks");
} catch {
  process.exit(0); // not a git checkout, or git isn't installed
}

const source = path.resolve(".githooks");
mkdirSync(hooksDir, { recursive: true });
for (const name of readdirSync(source)) {
  copyFileSync(path.join(source, name), path.join(hooksDir, name));
  chmodSync(path.join(hooksDir, name), 0o755);
}

try {
  const custom = git("config", "--get", "core.hooksPath");
  console.warn(`install-hooks: core.hooksPath is set to "${custom}", so git won't run the hooks installed in ${hooksDir}.`);
} catch {
  /* not set: git uses the hooks folder */
}
