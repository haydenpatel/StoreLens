#!/usr/bin/env node
// Manual smoke check that each supported platform's public feed still looks the
// way the adapters expect: reachable, CORS-readable from StoreLens's origin,
// right response shape, and paging that terminates.
//
//   npm run smoke
//
// Not part of `npm test` and not run in CI: it hits live stores. Responses are
// checked in memory and never written anywhere (the product data belongs to the
// merchants). Edit scripts/smoke-platforms.config.mjs to change the sample stores.
//
// Result per store:  pass | warn (works, but something looks off) |
//   gone (store removed/locked/empty: refresh the sample list) | fail.
// Each of Fourthwall and Big Cartel also gets an "error responses" row: it
// requests a known-missing resource and checks the status and CORS header the
// adapters' error handling assumes (see EXPECTED_ERRORS). A change there fails
// the run, since the user-facing error messages would go wrong silently.
// Exit code is 1 if any platform has no passing store, or an error-response
// assumption has changed.

import { PLATFORMS } from "./smoke-platforms.config.mjs";
import {
  STORELENS_ORIGIN,
  checkCors,
  checkErrorResponse,
  validateBigCartelProducts,
  validateBigCartelStore,
  validateFourthwallPage,
  validateShopifyCollections,
  validateShopifyPage,
  worstStatus,
} from "./smoke/checks.mjs";

const TIMEOUT_MS = 15_000;
const SHOPIFY_PAGE_SIZE = 250;
const FOURTHWALL_MAX_PAGES = 40; // 800 products; far more than a sample store should have
// A missing or removed store. 401/403 are not here: they could be a feed that
// changed or started blocking us, which should fail rather than hide. Big Cartel
// answers 403 for a locked shop, so it adds that one (see GONE_EXTRA).
const GONE_STATUSES = new Set([404, 410]);
const GONE_EXTRA = { bigcartel: new Set([403]) };
const GONE_NETWORK_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]);

async function requestOnce(url) {
  try {
    const response = await fetch(url, {
      headers: { Origin: STORELENS_ORIGIN, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let data = null;
    let parseError = false;
    try {
      data = JSON.parse(text);
    } catch {
      parseError = true;
    }
    return { status: response.status, headers: response.headers, data, parseError };
  } catch (err) {
    const code = err?.cause?.code;
    if (err?.name === "TimeoutError") return { error: "timed out", gone: false };
    return { error: code ?? err?.message ?? "network error", gone: GONE_NETWORK_CODES.has(code) };
  }
}

// One retry for flaky network or 5xx, so a blip doesn't read as drift.
async function request(url) {
  const first = await requestOnce(url);
  const transient = (first.error && !first.gone) || first.status >= 500;
  if (!transient) return first;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return requestOnce(url);
}

// Collects findings for one store. A fail outranks `gone` when both are set.
function newReport() {
  return { fails: [], warns: [], gone: null, note: "", cors: null };
}

// Handles the failure modes common to every first request. Returns true if the
// response is usable (HTTP 200, JSON).
function gate(report, res, extraGone) {
  if (res.error) {
    if (res.gone) report.gone = res.error;
    else report.fails.push(`request failed: ${res.error}`);
    return false;
  }
  if (GONE_STATUSES.has(res.status) || extraGone?.has(res.status)) {
    report.gone = `HTTP ${res.status}`;
    return false;
  }
  if (res.status !== 200) {
    report.fails.push(`HTTP ${res.status}`);
    return false;
  }
  if (res.parseError) {
    report.fails.push("response is not JSON");
    return false;
  }
  return true;
}

// A page after the first one disappearing is drift, not a vanished store: turn
// the `gone` the gate recorded into a failure that keeps its reason.
function failLaterPage(report, what) {
  report.fails.push(report.gone ? `${what}: ${report.gone}` : `${what} unusable`);
  report.gone = null;
}

// Checks CORS and shape of an OK response; true if both are fine.
function inspect(report, res, problems) {
  const found = [...checkCors(res.headers), ...problems];
  report.fails.push(...found);
  report.cors ??= res.headers.get("access-control-allow-origin");
  return found.length === 0;
}

async function checkShopify({ host, collection }) {
  const report = newReport();
  const base = `https://${host}/collections/${collection}/products.json?limit=${SHOPIFY_PAGE_SIZE}`;
  const page1 = await request(`${base}&page=1`);
  if (!gate(report, page1)) return report;
  if (!inspect(report, page1, validateShopifyPage(page1.data))) return report;
  const count = page1.data.products.length;
  if (count === 0) {
    report.gone = "collection is empty";
    return report;
  }
  report.note = `${count} products on page 1`;

  if (count === SHOPIFY_PAGE_SIZE) {
    const page2 = await request(`${base}&page=2`);
    if (!gate(report, page2)) {
      failLaterPage(report, "page 2");
    } else if (!inspect(report, page2, validateShopifyPage(page2.data))) {
      report.fails.push("page 2 unusable");
    } else if (page2.data.products.length === 0) {
      report.fails.push("page 2 is empty although page 1 was full");
    } else if (page2.data.products[0].id === page1.data.products[0].id) {
      report.fails.push("page 2 repeats page 1 (paging ignored)");
    } else {
      report.note += `, paging works`;
    }
  }

  // Collection discovery is a nice-to-have the adapter tolerates losing.
  const listing = await request(`https://${host}/collections.json?limit=250`);
  if (listing.error || listing.status !== 200 || listing.parseError) {
    report.warns.push("collections.json unavailable");
  } else {
    const problems = [...checkCors(listing.headers), ...validateShopifyCollections(listing.data)];
    if (problems.length) report.warns.push(`collections.json: ${problems.join("; ")}`);
  }
  return report;
}

async function checkFourthwall({ host }) {
  const report = newReport();
  let total = 0;
  for (let page = 1; page <= FOURTHWALL_MAX_PAGES; page++) {
    const res = await request(`https://${host}/collections/all/${page}.json`);
    if (!gate(report, res)) {
      if (page > 1) failLaterPage(report, `page ${page}`);
      return report;
    }
    if (!inspect(report, res, validateFourthwallPage(res.data, page))) return report;
    const count = res.data.products.length;
    if (count === 0) {
      if (page === 1) {
        report.gone = "no products";
      } else {
        report.note = `${total} products, ${page - 1} ${page === 2 ? "page" : "pages"}, empty page reached`;
      }
      return report;
    }
    total += count;
  }
  report.warns.push(`no empty page within ${FOURTHWALL_MAX_PAGES} pages`);
  report.note = `${total}+ products`;
  return report;
}

async function checkBigCartel({ shop }) {
  const report = newReport();
  const res = await request(`https://api.bigcartel.com/${shop}/products.json`);
  if (!gate(report, res, GONE_EXTRA.bigcartel)) return report;
  if (!inspect(report, res, validateBigCartelProducts(res.data))) return report;
  if (res.data.length === 0) {
    report.gone = "no products";
    return report;
  }
  report.note = `${res.data.length} products`;

  // store.json supplies the currency and the product count; the adapter relies on both.
  const info = await request(`https://api.bigcartel.com/${shop}/store.json`);
  if (info.error || info.status !== 200 || info.parseError) {
    report.fails.push(`store.json unavailable (${info.error ?? `HTTP ${info.status}`})`);
  } else {
    const problems = [...checkCors(info.headers), ...validateBigCartelStore(info.data)];
    if (problems.length) report.fails.push(`store.json: ${problems.join("; ")}`);
    else report.note += `, store.json ok (${info.data.currency.code}, products_count ${info.data.products_count})`;
  }
  return report;
}

// What the adapters assume about error responses, probed with a request for
// something that cannot exist. Fourthwall's errors carry no CORS headers, so the
// browser sees a network failure and the adapter probes to tell "not found" from
// "blocked"; Big Cartel's do, so the status is read directly.
const EXPECTED_ERRORS = {
  fourthwall: (host) => [
    { what: "nonexistent collection", url: `https://${host}/collections/storelens-smoke-no-such-collection/1.json`, expected: { status: 404, cors: false } },
    { what: "page 0", url: `https://${host}/collections/all/0.json`, expected: { status: 422, cors: false } },
  ],
  bigcartel: () => [
    { what: "nonexistent shop", url: `https://api.bigcartel.com/storelens-smoke-no-such-shop/products.json`, expected: { status: 404, cors: true } },
  ],
};

async function checkErrorResponses(platform, sampleStore) {
  const report = newReport();
  const probes = EXPECTED_ERRORS[platform.id]?.(sampleStore);
  if (!probes) return null;
  for (const { what, url, expected } of probes) {
    const problems = checkErrorResponse(await request(url), expected);
    if (problems.length) report.fails.push(`${what}: ${problems.join("; ")}`);
  }
  if (!report.fails.length) report.note = `${probes.map((p) => p.what).join(", ")} as assumed (HTTP ${probes.map((p) => p.expected.status).join("/")}, CORS ${probes[0].expected.cors ? "present" : "absent"})`;
  return report;
}

const CHECKERS = { shopify: checkShopify, fourthwall: checkFourthwall, bigcartel: checkBigCartel };

function summarise(report) {
  if (report.cors && !report.fails.length && !report.gone) report.note = `CORS ${report.cors}; ${report.note}`;
  if (report.fails.length) return { status: "fail", detail: report.fails.join("; ") };
  if (report.gone) return { status: "gone", detail: report.gone };
  if (report.warns.length) return { status: "warn", detail: [report.note, ...report.warns].filter(Boolean).join("; ") };
  return { status: "pass", detail: report.note };
}

const label = (store) => store.host ?? store.shop;

async function main() {
  const started = Date.now();
  const jobs = PLATFORMS.flatMap((platform) =>
    platform.stores.map(async (store) => {
      let result;
      try {
        result = summarise(await CHECKERS[platform.id](store));
      } catch (err) {
        result = { status: "fail", detail: `script error: ${err?.message}` };
      }
      return { platform, store: label(store), ...result };
    })
  );
  const stores = await Promise.all(jobs);
  const errorJobs = PLATFORMS.map(async (platform) => {
    let result;
    try {
      // Probe through a store that answered, not one that has gone.
      const sample = stores.find((r) => r.platform === platform && r.status !== "gone" && r.status !== "fail");
      if (!sample) return null;
      const report = await checkErrorResponses(platform, sample.store);
      if (!report) return null;
      result = summarise(report);
    } catch (err) {
      result = { status: "fail", detail: `script error: ${err?.message}` };
    }
    return { platform, store: "(error responses)", ...result };
  });
  const extras = (await Promise.all(errorJobs)).filter(Boolean);
  const rows = [...stores, ...extras];

  const widths = {
    platform: Math.max(8, ...rows.map((r) => r.platform.name.length)),
    store: Math.max(5, ...rows.map((r) => r.store.length)),
  };
  console.log(`Feed smoke check from Origin: ${STORELENS_ORIGIN}\n`);
  console.log(`${"Platform".padEnd(widths.platform)}  ${"Store".padEnd(widths.store)}  Result  Detail`);
  for (const r of rows) {
    console.log(
      `${r.platform.name.padEnd(widths.platform)}  ${r.store.padEnd(widths.store)}  ${r.status.toUpperCase().padEnd(6)}  ${r.detail}`
    );
  }

  console.log("");
  let failed = false;
  for (const platform of PLATFORMS) {
    const mine = stores.filter((r) => r.platform === platform);
    const passing = mine.filter((r) => r.status === "pass" || r.status === "warn").length;
    const tally = {};
    for (const r of mine) tally[r.status] = (tally[r.status] ?? 0) + 1;
    const counts = Object.entries(tally)
      .map(([status, n]) => `${n} ${status}`)
      .join(", ");
    const verdict = passing > 0 ? "OK" : "FAILED";
    if (passing === 0) failed = true;
    console.log(`${platform.name}: ${verdict} (${counts})`);
  }
  const drifted = extras.filter((r) => r.status !== "pass");
  for (const r of drifted) console.log(`${r.platform.name}: error-response assumptions changed (${r.detail})`);
  if (drifted.length) failed = true;
  const overall = worstStatus(rows.map((r) => r.status));
  console.log(`\n${failed ? "Platform-wide failure or changed error responses." : overall === "pass" ? "All stores passed." : "No platform-wide failure; see rows above."} (${Math.round((Date.now() - started) / 1000)}s)`);
  process.exitCode = failed ? 1 : 0;
}

await main();
