import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, HorizonFetchError } from "../horizon-fetch";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("fetchJson", () => {
  it.each(["fetch", "body", "retry-after"])("bounds a stalled %s with one deadline", async stage => {
    vi.useFakeTimers();
    const stalled = new Promise<never>(() => {});
    const fetcher = vi.fn().mockImplementation(() => stage === "fetch" ? stalled : stage === "body"
      ? Promise.resolve({ ok: true, json: () => stalled })
      : Promise.resolve(new Response(null, { status: 429, headers: { "Retry-After": "999999" } })));
    vi.stubGlobal("fetch", fetcher);
    const request = fetchJson("http://x", undefined, { timeoutMs: 100 });
    const rejection = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stalled opt-in request and cleans up its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const controller = new AbortController();
    const request = fetchJson("http://x", controller.signal, { timeoutMs: 100 });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not fetch an already cancelled request", async () => {
    const fetcher = vi.fn();vi.stubGlobal("fetch", fetcher);
    await expect(fetchJson("http://x", AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("notices cancellation from retry logging before waiting", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429 })));
    await expect(fetchJson("http://x", controller.signal, { onLog: () => controller.abort() })).rejects.toMatchObject({ name: "AbortError" });
  });

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

  it("respects Retry-After header (seconds) as the backoff delay", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(
        new Response("rate", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 5 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    vi.useFakeTimers();

    const p = fetchJson("http://x");
    // Default exponential backoff would be 500ms; Retry-After demands 2000ms,
    // so no retry should have fired yet at the 500ms mark.
    await vi.advanceTimersByTimeAsync(500);
    expect(f).toHaveBeenCalledTimes(1);
    // After the full 2000ms header delay the retry fires and succeeds.
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toEqual({ ok: 5 });
    expect(f).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("falls back to exponential backoff when Retry-After header absent", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("x", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 6 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    vi.useFakeTimers();

    const p = fetchJson("http://x");
    // Exponential backoff for the first retry is 500ms.
    await vi.advanceTimersByTimeAsync(499);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ ok: 6 });
    expect(f).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
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
