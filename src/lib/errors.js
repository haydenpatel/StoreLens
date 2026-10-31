// Why a store couldn't be read, in terms the UI can explain. Adapters throw or
// report a StoreError with a `kind`; describeStoreError turns it into copy, so
// the wording lives in one place and none of it names a platform.

export const FAILURE_KINDS = {
  "not-found": {
    message: "That collection wasn't found. Check the URL, or choose a collection from the dropdown.",
    reason: "that collection wasn't found",
  },
  "store-not-found": {
    message: "That store wasn't found. Check the address: it may be misspelt, or the store may have closed.",
    reason: "the store wasn't found",
  },
  locked: {
    message: "This store is locked, password protected or blocking access, so its products can't be read.",
    reason: "the store is locked or blocking access",
  },
  "blocked-or-offline": {
    // Stores on an unsupported platform usually land here too (they send no CORS
    // headers), so say what does work.
    message: (supported, _status, notes) =>
      `Couldn't reach this store from the browser. It may be offline, or it may not allow other sites to read its products.${supported ? ` StoreLens works with ${supported} stores.` : ""}${notes?.length ? ` ${notes.join(" ")}` : ""}`,
    reason: "the store couldn't be reached",
  },
  "unsupported-platform": {
    message: (supported) =>
      `This doesn't look like a store StoreLens can read.${supported ? ` It works with ${supported} stores that have a public product listing.` : ""} Password-protected stores can't be read either.`,
    reason: "the store didn't return product data",
  },
  empty: {
    message: "No products found in this collection.",
    reason: "the store stopped returning products",
  },
  "rate-limited": {
    message: "The store is limiting requests right now. Wait a moment and try again.",
    reason: "the store is limiting requests",
  },
  // Not a failure of the store: the user stopped the load. Shown on its own when
  // nothing had arrived yet, or as the reason in the partial-results warning.
  cancelled: {
    message: "Loading was cancelled before any products arrived.",
    reason: "loading was cancelled",
  },
  "server-error": {
    message: (_supported, status) =>
      `The store returned an error${status ? ` (status ${status})` : ""}. Try again shortly.`,
    reason: (status) => `the store returned an error${status ? ` (status ${status})` : ""}`,
  },
};

export class StoreError extends Error {
  constructor(kind, { status, cause } = {}) {
    super(status ? `${kind} (status ${status})` : kind, cause ? { cause } : undefined);
    this.name = "StoreError";
    this.kind = kind;
    this.status = status;
  }
}

// The user-facing sentence for a failure. `supported` is the supported
// platforms as text ("Shopify, Fourthwall or Big Cartel"); `notes` are the
// platforms' own sentences about what they can't read (see supportNote in
// platforms/types.js), added where a store that can't be reached may be one of
// them. Errors that aren't StoreErrors (an invalid URL, say) keep their own message.
export function describeStoreError(err, { supported, notes } = {}) {
  if (!(err instanceof StoreError)) return err?.message || "Something went wrong.";
  const copy = FAILURE_KINDS[err.kind] ?? FAILURE_KINDS["server-error"];
  return typeof copy.message === "function" ? copy.message(supported, err.status, notes) : copy.message;
}

// A short clause for the "couldn't fetch the rest (...)" warning.
export function describeStoreErrorReason(err) {
  if (!(err instanceof StoreError)) return err?.message || "an error occurred";
  const copy = FAILURE_KINDS[err.kind] ?? FAILURE_KINDS["server-error"];
  return typeof copy.reason === "function" ? copy.reason(err.status) : copy.reason;
}

export const isAbort = (err, signal) => signal?.aborted || err?.name === "AbortError";

// The reason a load's signal is aborted with when the user presses Cancel, as
// opposed to a newer load superseding it. Paging stops on it but keeps the pages
// that already arrived.
export const cancelledError = () => new StoreError("cancelled");
export const isCancelled = (signal) =>
  Boolean(signal?.aborted) && signal.reason instanceof StoreError && signal.reason.kind === "cancelled";

// How long one request may take before it is given up on as unreachable.
export const REQUEST_TIMEOUT_MS = 30_000;

// A signal that aborts when `signal` does, or with a TimeoutError after `ms`.
// `clear()` stops the timer and the link to `signal`; a caller that hands the
// response on leaves it running, so a body that stalls is cut off too.
export function withTimeout(signal, ms = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const clear = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  };
  const forward = () => {
    clear();
    controller.abort(signal.reason);
  };
  if (signal?.aborted) {
    controller.abort(signal.reason);
    return { signal: controller.signal, clear };
  }
  signal?.addEventListener("abort", forward, { once: true });
  timer = setTimeout(() => {
    clear();
    controller.abort(new DOMException("The request timed out", "TimeoutError"));
  }, ms);
  return { signal: controller.signal, clear };
}

// What an HTTP status says on its own, without looking at the store.
export function kindFromStatus(status) {
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "locked";
  if (status === 404 || status === 410) return "not-found";
  return "server-error";
}

// Asks a known-good URL whether the store itself can be read: resolves to
// { ok: true } or { ok: false, status? }, where no status means the request
// threw (offline, or blocked because the response carried no CORS headers).
// Rethrows an abort so a cancelled load never reports a diagnosis.
export async function probeUrl(url, signal) {
  const request = withTimeout(signal);
  try {
    const response = await fetch(url, { signal: request.signal });
    return response.ok ? { ok: true } : { ok: false, status: response.status };
  } catch (err) {
    if (isAbort(err, signal)) throw err;
    return { ok: false };
  } finally {
    request.clear();
  }
}

// Works out why a request failed. `status` is the HTTP status, or undefined if
// the request threw. A 404 (or a throw) is ambiguous: the collection may not
// exist, or the store may not be readable at all. Some platforms send no CORS
// headers on their 404, so the browser can't tell the two apart; `probe` (an
// async () => { ok, status? }) checks a URL that should always work for the same
// store to decide.
export async function diagnoseFailure({ status, probe, cause } = {}) {
  const make = (kind, s = status) => new StoreError(kind, { status: s, cause });
  // A request that timed out says the store is slow or unreachable, not that the
  // collection is missing, and a probe of the same store would only wait again.
  if (cause?.name === "TimeoutError") return make("blocked-or-offline", undefined);
  const ambiguous = status === undefined || status === 404 || status === 410;
  if (!ambiguous) return make(kindFromStatus(status));
  if (!probe) return make(status === undefined ? "blocked-or-offline" : "not-found");

  const result = await probe();
  if (result.ok) return make("not-found");
  if (result.status === 404 || result.status === 410) return make("unsupported-platform", result.status);
  if (result.status !== undefined) return make(kindFromStatus(result.status), result.status);
  return make("blocked-or-offline", undefined);
}
