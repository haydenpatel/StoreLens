// Runs on `npm install` (the "prepare" script): points git at the versioned
// hooks in .githooks, so every clone gets the guard against committing on
// main. Does nothing where there is no git checkout (e.g. a deploy build).
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
  /* not a git checkout, or git isn't installed */
}
