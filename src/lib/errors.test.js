import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FAILURE_KINDS,
  StoreError,
  describeStoreError,
  describeStoreErrorReason,
  diagnoseFailure,
  kindFromStatus,
  probeUrl,
} from "./errors";
import { jsonResponse } from "./__fixtures__/test-helpers";

afterEach(() => vi.unstubAllGlobals());

describe("describeStoreError", () => {
  const SUPPORTED = "Alpha, Beta or Gamma";

  it("has copy for every failure kind", () => {
    for (const kind of Object.keys(FAILURE_KINDS)) {
      const message = describeStoreError(new StoreError(kind, { status: 503 }), { supported: SUPPORTED });
      expect(message.length).toBeGreaterThan(10);
      expect(describeStoreErrorReason(new StoreError(kind, { status: 503 })).length).toBeGreaterThan(5);
    }
  });

  it("never names a platform in the generic copy", () => {
    for (const kind of Object.keys(FAILURE_KINDS)) {
      const err = new StoreError(kind, { status: 503 });
      expect(describeStoreError(err)).not.toMatch(/shopify|fourthwall|big cartel/i);
      expect(describeStoreErrorReason(err)).not.toMatch(/shopify|fourthwall|big cartel/i);
    }
  });

  it("lists the supported platforms for an unsupported store", () => {
    const message = describeStoreError(new StoreError("unsupported-platform"), { supported: SUPPORTED });
    expect(message).toContain("Alpha, Beta or Gamma");
  });

  it("still reads sensibly without a platform list", () => {
    expect(describeStoreError(new StoreError("unsupported-platform"))).not.toContain("undefined");
  });

  it("mentions the status for a server error, and only when there is one", () => {
    expect(describeStoreError(new StoreError("server-error", { status: 502 }))).toContain("502");
    expect(describeStoreError(new StoreError("server-error"))).not.toContain("undefined");
    expect(describeStoreErrorReason(new StoreError("server-error", { status: 502 }))).toContain("502");
  });

  it("keeps the message of an error that isn't a StoreError", () => {
    expect(describeStoreError(new Error("Please enter a valid collection URL"))).toBe("Please enter a valid collection URL");
    expect(describeStoreErrorReason(new Error("network down"))).toBe("network down");
  });

  it("falls back to the server-error copy for an unknown kind", () => {
    expect(describeStoreError(new StoreError("something-new", { status: 500 }))).toContain("error");
  });
});

describe("kindFromStatus", () => {
  it.each([
    [429, "rate-limited"],
    [401, "locked"],
    [403, "locked"],
    [404, "not-found"],
    [410, "not-found"],
    [500, "server-error"],
    [503, "server-error"],
    [422, "server-error"],
  ])("maps %i to %s", (status, kind) => {
    expect(kindFromStatus(status)).toBe(kind);
  });
});

describe("diagnoseFailure", () => {
  const probeWith = (result) => vi.fn(async () => result);

  it("maps a clear status without probing", async () => {
    const probe = probeWith({ ok: true });
    expect((await diagnoseFailure({ status: 429, probe })).kind).toBe("rate-limited");
    expect((await diagnoseFailure({ status: 403, probe })).kind).toBe("locked");
    expect((await diagnoseFailure({ status: 502, probe })).kind).toBe("server-error");
    expect(probe).not.toHaveBeenCalled();
  });

  it("keeps the status on the error", async () => {
    expect((await diagnoseFailure({ status: 502 })).status).toBe(502);
  });

  describe("an opaque failure (the request threw)", () => {
    it("is a missing collection when the probe shows the store is readable", async () => {
      const err = await diagnoseFailure({ probe: probeWith({ ok: true }) });
      expect(err.kind).toBe("not-found");
    });

    it("is blocked-or-offline when the probe throws too", async () => {
      const err = await diagnoseFailure({ probe: probeWith({ ok: false }) });
      expect(err.kind).toBe("blocked-or-offline");
    });

    it("reports what the probe's own status says", async () => {
      expect((await diagnoseFailure({ probe: probeWith({ ok: false, status: 404 }) })).kind).toBe("unsupported-platform");
      expect((await diagnoseFailure({ probe: probeWith({ ok: false, status: 403 }) })).kind).toBe("locked");
      expect((await diagnoseFailure({ probe: probeWith({ ok: false, status: 503 }) })).kind).toBe("server-error");
    });

    it("assumes blocked-or-offline without a probe", async () => {
      const cause = new TypeError("Failed to fetch");
      const err = await diagnoseFailure({ cause });
      expect(err.kind).toBe("blocked-or-offline");
      expect(err.cause).toBe(cause);
    });
  });

  describe("a 404", () => {
    it("is a missing collection when the store's probe works", async () => {
      expect((await diagnoseFailure({ status: 404, probe: probeWith({ ok: true }) })).kind).toBe("not-found");
    });

    it("is an unsupported platform when the probe 404s too", async () => {
      const err = await diagnoseFailure({ status: 404, probe: probeWith({ ok: false, status: 404 }) });
      expect(err.kind).toBe("unsupported-platform");
    });

    it("is blocked-or-offline when the probe can't be read", async () => {
      expect((await diagnoseFailure({ status: 404, probe: probeWith({ ok: false }) })).kind).toBe("blocked-or-offline");
    });

    it("is not-found without a probe", async () => {
      expect((await diagnoseFailure({ status: 404 })).kind).toBe("not-found");
      expect((await diagnoseFailure({ status: 410 })).kind).toBe("not-found");
    });
  });

  it("lets an abort from the probe propagate", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    await expect(diagnoseFailure({ probe: async () => Promise.reject(abort) })).rejects.toBe(abort);
  });
});

describe("probeUrl", () => {
  it("reports ok for a successful response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    expect(await probeUrl("https://shop.example.com/x")).toEqual({ ok: true });
  });

  it("reports the status of a failing response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { ok: false, status: 404 })));
    expect(await probeUrl("https://shop.example.com/x")).toEqual({ ok: false, status: 404 });
  });

  it("reports a thrown request as ok:false with no status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await probeUrl("https://shop.example.com/x")).toEqual({ ok: false });
  });

  it("rethrows an abort", async () => {
    const controller = new AbortController();
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw abort;
      })
    );
    await expect(probeUrl("https://shop.example.com/x", controller.signal)).rejects.toBe(abort);
  });
});
