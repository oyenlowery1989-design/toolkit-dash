import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAddressBalance } from "@/lib/address-balances/fetchers";

const ADDR = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";

describe("fetchAddressBalance", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok with total/available on success", async () => {
    (fetch as any).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        subentry_count: 0,
        num_sponsoring: 0,
        num_sponsored: 0,
        balances: [{ asset_type: "native", balance: "50.0000000" }],
        signers: [{ key: ADDR, weight: 10 }],
        thresholds: { low_threshold: 0, med_threshold: 1, high_threshold: 1 },
      }),
    });

    const result = await fetchAddressBalance("https://horizon.example", ADDR);
    expect(result).toEqual({ status: "ok", total: 50, available: 49, locked: false, lockReason: null });
  });

  it("returns unfunded on 404", async () => {
    (fetch as any).mockResolvedValue({ status: 404, ok: false });
    const result = await fetchAddressBalance("https://horizon.example", ADDR);
    expect(result).toEqual({ status: "unfunded" });
  });

  it("returns error on non-OK non-404 response", async () => {
    (fetch as any).mockResolvedValue({ status: 500, ok: false });
    const result = await fetchAddressBalance("https://horizon.example", ADDR);
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when fetch throws", async () => {
    (fetch as any).mockRejectedValue(new Error("network down"));
    const result = await fetchAddressBalance("https://horizon.example", ADDR);
    expect(result).toEqual({ status: "error" });
  });
});
