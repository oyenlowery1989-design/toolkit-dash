import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, HorizonFetchError } from "../horizon-fetch";

afterEach(() => vi.restoreAllMocks());

describe("fetchJson", () => {
  it("returns parsed JSON on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
    await expect(fetchJson("http://x")).resolves.toEqual({ ok: 1 });
  });

  it("retries 429 then succeeds", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("rate", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    vi.useFakeTimers();
    const p = fetchJson("http://x");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: 2 });
    expect(f).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws HorizonFetchError after retries exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 503 })));
    vi.useFakeTimers();
    const p = fetchJson("http://x", undefined, { retries: 1 });
    p.catch(() => {}); // avoid unhandled rejection while timers run
    await vi.runAllTimersAsync();
    await expect(p).rejects.toBeInstanceOf(HorizonFetchError);
    vi.useRealTimers();
  });

  it("does NOT retry 404 — throws immediately", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nf", { status: 404 }));
    vi.stubGlobal("fetch", f);
    await expect(fetchJson("http://x")).rejects.toBeInstanceOf(HorizonFetchError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("rethrows abort without retry", async () => {
    const err = new DOMException("aborted", "AbortError");
    const f = vi.fn().mockRejectedValue(err);
    vi.stubGlobal("fetch", f);
    await expect(fetchJson("http://x")).rejects.toBe(err);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("removes abort listener after backoff sleep resolves (no accumulation)", async () => {
    const controller = new AbortController();
    const addEventListenerSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(controller.signal, "removeEventListener");

    const f = vi.fn()
      .mockResolvedValueOnce(new Response("rate", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 3 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    vi.useFakeTimers();

    const p = fetchJson("http://x", controller.signal);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: 3 });

    // Should have added one "abort" listener during backoff
    const abortListenerCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "abort"
    );
    expect(abortListenerCalls.length).toBeGreaterThanOrEqual(1);

    // Should have removed the same number of "abort" listeners
    const abortRemovalCalls = removeEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "abort"
    );
    expect(abortRemovalCalls.length).toBe(abortListenerCalls.length);

    vi.useRealTimers();
  });
});
