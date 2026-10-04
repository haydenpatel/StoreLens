// Request plumbing shared by platform adapters: retrying the failures worth
// retrying, and fetching a paged listing with bounded concurrency.
import { isAbort } from "@/lib/errors";

const abortError = (signal) =>
  signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");

// Resolves after `ms`, or rejects as soon as the signal aborts.
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// How long to wait before retry number `attempt` (0-based): the store's own
// Retry-After (seconds) when it gives one, else exponential backoff. Capped so
// a long Retry-After can't leave the user staring at a spinner.
function retryDelayMs(response, attempt, { baseDelayMs, maxDelayMs }) {
  const retryAfter = Number(response.headers?.get?.("retry-after"));
  const wanted = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** attempt;
  return Math.min(wanted, maxDelayMs);
}

// fetch() that retries 429 and 5xx responses with backoff and returns the last
// response either way, so the caller decides what a failure means. A request
// that throws (offline, or blocked by CORS) isn't retried: it would fail again
// and just delay the answer. Aborts reject straight away, including mid-wait.
export async function fetchWithRetry(url, { signal, retries = 2, baseDelayMs = 500, maxDelayMs = 5000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { signal });
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= retries) return response;
    await delay(retryDelayMs(response, attempt, { baseDelayMs, maxDelayMs }), signal);
  }
}

// Fetches pages 1, 2, 3... of a listing whose length isn't known up front,
// `concurrency` pages at a time, until a page says it is the last one, comes
// back empty, or `maxPages` is reached.
//
// `fetchPage(n)` resolves to { items, done } and throws on failure. The result
// is always a contiguous run of pages from the start: if page k fails, pages
// after k are dropped even if they arrived, and what loaded before it is kept
// alongside the error so the caller can show partial results.
//
// Returns { items, pageError, truncated }; `truncated` means `maxPages` ran out
// with more to come. Rethrows an abort.
export async function fetchPages({ fetchPage, concurrency = 1, maxPages = Infinity, signal, onProgress }) {
  const items = [];
  let pageError = null;
  let done = false;
  let next = 1;

  while (!done && next <= maxPages) {
    const batch = [];
    for (let i = 0; i < concurrency && next + i <= maxPages; i++) batch.push(next + i);
    const results = await Promise.allSettled(batch.map((page) => fetchPage(page)));
    if (signal?.aborted) {
      const rejected = results.find((r) => r.status === "rejected" && isAbort(r.reason, signal));
      throw rejected ? rejected.reason : abortError(signal);
    }

    for (const result of results) {
      if (result.status === "rejected") {
        if (isAbort(result.reason, signal)) throw result.reason;
        pageError = result.reason;
        done = true;
        break;
      }
      const page = result.value;
      for (const item of page.items) items.push(item);
      onProgress?.({ loaded: items.length });
      if (page.done || page.items.length === 0) {
        done = true;
        break;
      }
    }
    next += batch.length;
  }

  return { items, pageError, truncated: !done && next > maxPages };
}
