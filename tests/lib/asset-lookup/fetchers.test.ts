import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAssetXlmTrades, inferDistribLite } from "@/lib/asset-lookup/fetchers";

const HORIZON = "https://horizon.example.com";
const ISSUER = "GISSUER";

afterEach(() => vi.restoreAllMocks());

describe("inferDistribLite", () => {
  it("bounds an opted-in inference request", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
      const request = inferDistribLite(HORIZON, "Token", ISSUER, new AbortController().signal, undefined, { requestTimeoutMs: 100 });
      const rejection = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
    } finally { vi.useRealTimers(); }
  });
  it("does not infer a recipient from a case-distinct asset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          _embedded: {
            records: [
              {
                type: "payment",
                from: ISSUER,
                to: "GDISTRIBUTOR",
                asset_code: "TOKEN",
                asset_issuer: ISSUER,
                amount: "100",
              },
            ],
          },
        }),
      ),
    );

    const candidates = await inferDistribLite(
      HORIZON,
      "Token",
      ISSUER,
      new AbortController().signal,
    );

    expect(candidates).toEqual([]);
  });

  it("surfaces Horizon failures instead of reporting no candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 400 })),
    );

    await expect(
      inferDistribLite(
        HORIZON,
        "TOKEN",
        ISSUER,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Horizon request failed (400)");
  });
});

describe("fetchAssetXlmTrades", () => {
  it("rejects when a later trade page fails instead of returning partial totals", async () => {
    const records = Array.from({ length: 200 }, (_, i) => ({
      id: String(i), paging_token: String(i), base_amount: "1", counter_amount: "2",
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ _embedded: { records } }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAssetXlmTrades(HORIZON, "TOKEN", ISSUER, [], new AbortController().signal))
      .rejects.toThrow("Horizon request failed (400)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects when a tracked account trade page fails", async () => {
    const empty = () => Response.json({ _embedded: { records: [] } });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(new Response("unavailable", { status: 400 }))
      .mockResolvedValueOnce(empty()));

    await expect(fetchAssetXlmTrades(HORIZON, "TOKEN", ISSUER, ["GACCOUNT"], new AbortController().signal))
      .rejects.toThrow("Horizon request failed (400)");
  });
});
