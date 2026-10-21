// Vitest setup file (see vite.config.js): no test may reach the real network.
//
// Every test starts with a global `fetch` that records the request and rejects.
// Rejecting alone isn't enough: adapters catch fetch errors (a failed platform
// check just means "not this platform"), so a test that forgot to stub `fetch`
// could still pass. The afterEach hook below fails any test that called it, with
// the URLs it tried. Tests that need `fetch` stub it (vi.stubGlobal), which
// replaces this guard for that test; vi.unstubAllGlobals() brings it back.
import { afterEach, beforeEach } from "vitest";

const attempts = [];

function unstubbedFetch(input) {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  attempts.push(url);
  return Promise.reject(new TypeError(`Unstubbed fetch: ${url}`));
}

beforeEach(() => {
  attempts.length = 0;
  globalThis.fetch = unstubbedFetch;
});

afterEach(() => {
  if (attempts.length === 0) return;
  const urls = [...new Set(attempts)];
  attempts.length = 0;
  throw new Error(`The test made a request without stubbing fetch (use vi.stubGlobal("fetch", ...)):\n  ${urls.join("\n  ")}`);
});
