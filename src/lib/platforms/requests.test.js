import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreError, cancelledError } from "@/lib/errors";
import { fetchPages, fetchWithRetry } from "./requests";

const response = (status, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithRetry", () => {
  it("returns a good response without retrying", async () => {
    const fetchMock = vi.fn(async () => response(200));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchWithRetry("https://x.example/a")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives fetch a signal that follows the one it was given", async () => {
    const fetchMock = vi.fn(async () => response(200));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await fetchWithRetry("https://x.example/a", { signal: controller.signal });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x.example/a");
    expect(init.signal.aborted).toBe(false);
    controller.abort();
    expect(init.signal.aborted).toBe(true);
  });

  it("retries a 429 and a 5xx, with exponential backoff", async () => {
    const statuses = [429, 503, 200];
    const fetchMock = vi.fn(async () => response(statuses.shift()));
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchWithRetry("https://x.example/a", { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns the last failing response once retries run out", async () => {
    const fetchMock = vi.fn(async () => response(503));
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchWithRetry("https://x.example/a", { retries: 2, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    expect((await result).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 404 or 403", async () => {
    for (const status of [404, 403]) {
      const fetchMock = vi.fn(async () => response(status));
      vi.stubGlobal("fetch", fetchMock);
      expect((await fetchWithRetry("https://x.example/a")).status).toBe(status);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("does not retry a request that throws", async () => {
    const error = new TypeError("Failed to fetch");
    const fetchMock = vi.fn(async () => Promise.reject(error));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithRetry("https://x.example/a")).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits as long as Retry-After says, within the cap", async () => {
    const queue = [response(429, { "retry-after": "2" }), response(200)];
    const fetchMock = vi.fn(async () => queue.shift());
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchWithRetry("https://x.example/a", { baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe(200);
  });

  it("caps a long Retry-After", async () => {
    const queue = [response(429, { "retry-after": "120" }), response(200)];
    vi.stubGlobal("fetch", vi.fn(async () => queue.shift()));

    const result = fetchWithRetry("https://x.example/a", { maxDelayMs: 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await result).status).toBe(200);
  });

  it("ignores a Retry-After it can't read", async () => {
    const queue = [response(503, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }), response(200)];
    vi.stubGlobal("fetch", vi.fn(async () => queue.shift()));

    const result = fetchWithRetry("https://x.example/a", { baseDelayMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect((await result).status).toBe(200);
  });

  it("copes with a response that has no headers", async () => {
    const queue = [{ ok: false, status: 503 }, response(200)];
    vi.stubGlobal("fetch", vi.fn(async () => queue.shift()));
    const result = fetchWithRetry("https://x.example/a", { baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    expect((await result).status).toBe(200);
  });

  it("stops waiting as soon as the signal aborts", async () => {
    const fetchMock = vi.fn(async () => response(503));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const result = fetchWithRetry("https://x.example/a", { signal: controller.signal, baseDelayMs: 10_000, maxDelayMs: 10_000 });
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not wait at all if already aborted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(503)));
    const controller = new AbortController();
    controller.abort();
    await expect(fetchWithRetry("https://x.example/a", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

// A fetch that never answers but rejects, like a real one, when its signal aborts.
const stalledFetch = () =>
  vi.fn(
    (_url, { signal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  );

describe("fetchWithRetry timeout", () => {
  it("rejects with a TimeoutError once a request takes longer than the timeout, without retrying", async () => {
    const fetchMock = stalledFetch();
    vi.stubGlobal("fetch", fetchMock);
    const result = fetchWithRetry("https://x.example/a", { timeoutMs: 1000 });
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times each attempt on its own, leaving out the wait between attempts", async () => {
    // Each answer takes 800 ms and the backoff 900 ms: 3.3 s overall, every
    // piece inside the 1 s limit.
    const statuses = [503, 503, 200];
    const fetchMock = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(response(statuses.shift())), 800))
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = fetchWithRetry("https://x.example/a", { timeoutMs: 1000, baseDelayMs: 900, maxDelayMs: 900 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await result).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("times out a retried attempt too", async () => {
    const queue = [() => Promise.resolve(response(503)), null];
    const stalled = stalledFetch();
    vi.stubGlobal("fetch", vi.fn((url, init) => (queue.shift() ?? (() => stalled(url, init)))()));
    const result = fetchWithRetry("https://x.example/a", { timeoutMs: 1000, baseDelayMs: 100 });
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1200);
    await assertion;
  });

  it("cuts off a body that stalls after the headers arrived", async () => {
    let bodySignal;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, { signal }) => {
        bodySignal = signal;
        return response(200);
      })
    );
    await fetchWithRetry("https://x.example/a", { timeoutMs: 1000 });
    expect(bodySignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bodySignal.aborted).toBe(true);
    expect(bodySignal.reason.name).toBe("TimeoutError");
  });

  it("passes the caller's own abort reason through, rather than a timeout", async () => {
    vi.stubGlobal("fetch", stalledFetch());
    const controller = new AbortController();
    const result = fetchWithRetry("https://x.example/a", { signal: controller.signal, timeoutMs: 1000 });
    const reason = cancelledError();
    const assertion = expect(result).rejects.toBe(reason);
    controller.abort(reason);
    await assertion;
  });
});

describe("fetchWithRetry body cleanup", () => {
  it("cancels the body of a response it retries past, but not the one it returns", async () => {
    const bad = { ...response(503), body: { cancel: vi.fn(async () => {}) } };
    const good = { ...response(200), body: { cancel: vi.fn(async () => {}) } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good));
    const result = fetchWithRetry("https://x.example/a", { baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    expect(await result).toBe(good);
    expect(bad.body.cancel).toHaveBeenCalledOnce();
    expect(good.body.cancel).not.toHaveBeenCalled();
  });

  it("still retries when there is no body or cancelling rejects", async () => {
    const noBody = response(500);
    const failing = { ...response(502), body: { cancel: vi.fn(async () => Promise.reject(new Error("locked"))) } };
    const good = response(200);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(noBody).mockResolvedValueOnce(failing).mockResolvedValueOnce(good));
    const result = fetchWithRetry("https://x.example/a", { baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    expect(await result).toBe(good);
  });
});

describe("fetchPages", () => {
  // Pages 1..total hold `size` items each; the last holds `lastSize`.
  const listing = ({ total, size = 3, lastSize = size, fail = {} }) =>
    vi.fn(async (page) => {
      if (fail[page]) throw fail[page];
      if (page > total) return { items: [], done: true };
      const count = page === total ? lastSize : size;
      return { items: Array.from({ length: count }, (_, i) => `${page}.${i}`), done: count < size };
    });

  it("fetches pages in order until a short page", async () => {
    const fetchPage = listing({ total: 3, size: 3, lastSize: 1 });
    const result = await fetchPages({ fetchPage });
    expect(result.items).toEqual(["1.0", "1.1", "1.2", "2.0", "2.1", "2.2", "3.0"]);
    expect(result).toMatchObject({ pageError: null, truncated: false });
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it("stops on an empty page", async () => {
    const fetchPage = listing({ total: 2, size: 2 });
    const result = await fetchPages({ fetchPage });
    expect(result.items).toHaveLength(4);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("returns nothing and no error for a store with no products", async () => {
    const result = await fetchPages({ fetchPage: listing({ total: 0 }) });
    expect(result).toEqual({ items: [], pageError: null, truncated: false });
  });

  it("is truncated when maxPages runs out with more to come", async () => {
    const fetchPage = listing({ total: 10, size: 2 });
    const result = await fetchPages({ fetchPage, maxPages: 3 });
    expect(result.items).toHaveLength(6);
    expect(result.truncated).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("is not truncated when the last allowed page is the last page", async () => {
    const result = await fetchPages({ fetchPage: listing({ total: 3, size: 2, lastSize: 1 }), maxPages: 3 });
    expect(result.truncated).toBe(false);
  });

  it("keeps what loaded before a failed page, and reports the error", async () => {
    const error = new Error("boom");
    const result = await fetchPages({ fetchPage: listing({ total: 5, fail: { 3: error } }) });
    expect(result.items).toHaveLength(6);
    expect(result.pageError).toBe(error);
    expect(result.truncated).toBe(false);
  });

  it("reports a first-page failure with no items", async () => {
    const error = new Error("boom");
    const result = await fetchPages({ fetchPage: listing({ total: 5, fail: { 1: error } }) });
    expect(result.items).toEqual([]);
    expect(result.pageError).toBe(error);
  });

  it("reports progress after each page", async () => {
    const onProgress = vi.fn();
    await fetchPages({ fetchPage: listing({ total: 3, size: 2, lastSize: 1 }), onProgress });
    expect(onProgress.mock.calls.map(([p]) => p.loaded)).toEqual([2, 4, 5]);
  });

  it("rethrows an abort, even from a late page", async () => {
    const controller = new AbortController();
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchPage = vi.fn(async (page) => {
      if (page === 2) {
        controller.abort();
        throw abort;
      }
      return { items: ["a"], done: false };
    });
    await expect(fetchPages({ fetchPage, signal: controller.signal })).rejects.toBe(abort);
  });

  it("throws an abort that happens while pages resolve normally", async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn(async () => {
      controller.abort();
      return { items: ["a"], done: false };
    });
    await expect(fetchPages({ fetchPage, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  describe("when cancelled", () => {
    const cancelled = () => {
      const controller = new AbortController();
      controller.abort(cancelledError());
      return controller;
    };

    it("keeps the pages that arrived and reports the cancel", async () => {
      const controller = new AbortController();
      const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
      const fetchPage = vi.fn(async (page) => {
        if (page === 3) {
          controller.abort(cancelledError());
          throw abort;
        }
        return { items: [`p${page}`], done: false };
      });
      const result = await fetchPages({ fetchPage, signal: controller.signal });
      expect(result.items).toEqual(["p1", "p2"]);
      expect(result.pageError).toBeInstanceOf(StoreError);
      expect(result.pageError.kind).toBe("cancelled");
      expect(result.truncated).toBe(false);
      expect(fetchPage).toHaveBeenCalledTimes(3);
    });

    it("reports a cancel with nothing loaded", async () => {
      const controller = cancelled();
      const fetchPage = vi.fn(async () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      const result = await fetchPages({ fetchPage, signal: controller.signal });
      expect(result.items).toEqual([]);
      expect(result.pageError.kind).toBe("cancelled");
    });

    it("keeps a contiguous run when a concurrent batch is cut short", async () => {
      const controller = new AbortController();
      const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
      const fetchPage = vi.fn(async (page) => {
        if (page === 2) {
          controller.abort(cancelledError());
          throw abort;
        }
        return { items: [`p${page}`], done: false };
      });
      const result = await fetchPages({ fetchPage, concurrency: 3, signal: controller.signal });
      // Page 3 arrived, but page 2 didn't: it can't be kept without a gap.
      expect(result.items).toEqual(["p1"]);
      expect(result.pageError.kind).toBe("cancelled");
    });

    it("still throws an ordinary abort", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(fetchPages({ fetchPage: async () => ({ items: ["a"], done: false }), signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
    });
  });

  describe("with concurrency", () => {
    it("never has more requests in flight than the limit", async () => {
      let inFlight = 0;
      let peak = 0;
      const fetchPage = vi.fn(async (page) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight--;
        return page > 9 ? { items: [], done: true } : { items: [page], done: false };
      });
      const run = fetchPages({ fetchPage, concurrency: 4 });
      await vi.runAllTimersAsync();
      const result = await run;
      expect(peak).toBe(4);
      expect(result.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("keeps items in page order even when pages finish out of order", async () => {
      const fetchPage = vi.fn(async (page) => {
        await new Promise((resolve) => setTimeout(resolve, page === 1 ? 50 : 5));
        return page > 3 ? { items: [], done: true } : { items: [page], done: false };
      });
      const run = fetchPages({ fetchPage, concurrency: 3 });
      await vi.runAllTimersAsync();
      expect((await run).items).toEqual([1, 2, 3]);
    });

    it("drops pages after a failed one even if they arrived", async () => {
      const error = new Error("boom");
      const fetchPage = vi.fn(async (page) => {
        if (page === 3) throw error;
        return { items: [page], done: false };
      });
      const result = await fetchPages({ fetchPage, concurrency: 4 });
      expect(result.items).toEqual([1, 2]);
      expect(result.pageError).toBe(error);
      expect(fetchPage).toHaveBeenCalledTimes(4);
    });

    it("discards pages fetched past the end of the listing", async () => {
      const fetchPage = vi.fn(async (page) =>
        page <= 2 ? { items: [page], done: page === 2 } : { items: ["stray"], done: false }
      );
      const result = await fetchPages({ fetchPage, concurrency: 4 });
      expect(result.items).toEqual([1, 2]);
    });

    it("does not start more pages than maxPages", async () => {
      const fetchPage = vi.fn(async (page) => ({ items: [page], done: false }));
      const result = await fetchPages({ fetchPage, concurrency: 4, maxPages: 6 });
      expect(fetchPage).toHaveBeenCalledTimes(6);
      expect(result.items).toEqual([1, 2, 3, 4, 5, 6]);
      expect(result.truncated).toBe(true);
    });
  });
});
