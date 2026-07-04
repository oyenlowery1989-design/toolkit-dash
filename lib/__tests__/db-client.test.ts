import { describe, it, expect, vi, afterEach } from "vitest";
import { dbPost, dbPatch, dbDelete, createDbCache, setDbAuthToken } from "../db-client";

// waitForAuth() resolves immediately in the browser when Supabase isn't configured,
// but in the vitest "node" environment `window` is undefined so it would otherwise
// block forever on `_authReadyPromise`. Mark auth as initialised up front.
setDbAuthToken(null);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("dbPost/dbPatch/dbDelete throw on failure", () => {
  it("dbPost throws on 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    await expect(dbPost("/api/db/groups", {})).rejects.toThrow();
  });

  it("dbPost resolves on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(dbPost("/api/db/groups", {})).resolves.toBeUndefined();
  });

  it("dbPatch throws on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(dbPatch("/api/db/groups", {})).rejects.toThrow("network down");
  });

  it("dbDelete throws on 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    await expect(dbDelete("/api/db/groups", "id-1")).rejects.toThrow();
  });
});

describe("createDbCache load failure path", () => {
  it("failed load leaves isLoaded false and exposes an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    const cache = createDbCache<{ id: string }>();
    await cache.load("/api/db/test-x").catch(() => {});
    expect(cache.isLoaded()).toBe(false);
    expect(cache.get()).toEqual([]);
    expect(cache.error()).toBeTruthy();
  });

  it("successful load sets isLoaded true and clears error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "a" }]), { status: 200 })),
    );
    const cache = createDbCache<{ id: string }>();
    await cache.load("/api/db/test-y");
    expect(cache.isLoaded()).toBe(true);
    expect(cache.get()).toEqual([{ id: "a" }]);
    expect(cache.error()).toBeNull();
  });

  it("schedules exactly one retry after a failed load, which succeeds on the second attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "b" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const cache = createDbCache<{ id: string }>();
    await cache.load("/api/db/test-retry").catch(() => {});
    expect(cache.isLoaded()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cache.isLoaded()).toBe(true);
    expect(cache.get()).toEqual([{ id: "b" }]);
  });
});

describe("createDbCache reload while load in-flight", () => {
  it("reload chains a fresh fetch instead of returning the stale in-flight promise", async () => {
    let resolveFirst: (r: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify([{ id: "c" }]), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const cache = createDbCache<{ id: string }>();
    const loadPromise = cache.load("/api/db/test-chain");
    // Kick off reload while the initial load is still in-flight.
    const reloadPromise = cache.reload("/api/db/test-chain");

    resolveFirst!(new Response(JSON.stringify([{ id: "old" }]), { status: 200 }));
    await loadPromise;
    await reloadPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cache.get()).toEqual([{ id: "c" }]);
  });
});
