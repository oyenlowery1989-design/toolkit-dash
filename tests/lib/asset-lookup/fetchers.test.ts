import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAssetXlmTrades, inferDistribLite } from "@/lib/asset-lookup/fetchers";

const HORIZON = "https://horizon.example.com";
const ISSUER = "GANJULEAUA7FO4G4VADKZGZ4R7BIRWFQWFCWD6D7W5UDV2D4TJ3CPYTQ";

afterEach(() => vi.restoreAllMocks());

describe("inferDistribLite", () => {
  const intermediary = "GC67QDUVNVJBSNEI6FHPNGPDKUKZEZWNHVWT6E4L5XS5SYCKA2WAUTD6";
  const seller = "GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH";
  const balanceId = "000000003b347a425e7ebb55a6bf5857f2995c021e645f7354e5757a87122b6cd4bd993e";
  const creation = {
    id: "create-1", paging_token: "301", transaction_successful: true,
    type: "create_claimable_balance", source_account: intermediary,
    asset: `AFLWA:${ISSUER}`, amount: "5000000",
    claimants: [{ destination: "GELIGIBLE" }, { destination: seller }],
  };

  function stubClaimableFlow(claims: unknown[], options: { failClaims?: boolean; paginate?: boolean; wrongEffect?: boolean; endless?: boolean; amount?: string; duplicate?: boolean; unprovenCreation?: boolean } = {}) {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      let records: unknown[] = [];
      if (url.pathname === `/accounts/${ISSUER}/payments`) {
        records = [{ type: "payment", from: ISSUER, to: intermediary,
          asset_code: "AFLWA", asset_issuer: ISSUER, amount: "5000000", paging_token: "100" }];
      } else if (url.pathname === `/accounts/${intermediary}/operations`) {
        records = options.endless || (options.paginate && url.searchParams.get("cursor") !== "300")
          ? Array.from({ length: 200 }, (_, i) => ({ type: "change_trust", paging_token: String(Number(url.searchParams.get("cursor") ?? "100") + i + 1) }))
          : Array.from({ length: options.duplicate ? 2 : 1 }, () => ({ ...creation,
            transaction_successful: options.unprovenCreation ? undefined : true, amount: options.amount ?? creation.amount }));
      } else if (url.pathname === "/operations/create-1/effects") {
        records = [{ type: "claimable_balance_created", balance_id: balanceId,
          asset: `${options.wrongEffect ? "OTHER" : "AFLWA"}:${ISSUER}`, amount: options.amount ?? creation.amount, account: intermediary }];
      } else if (url.pathname === `/claimable_balances/${balanceId}/operations`) {
        if (options.failClaims) return new Response("history unavailable", { status: 410 });
        records = claims;
      } else {
        throw new Error(`Unexpected Horizon URL: ${url}`);
      }
      return Response.json({ _embedded: { records } });
    }));
  }

  it("ranks the actual claimant ahead of the issuer-funded claimable-balance creator", async () => {
    stubClaimableFlow([{ type: "claim_claimable_balance", balance_id: balanceId,
      source_account: seller, claimant: seller, transaction_successful: true }]);
    const candidates = await inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal);
    expect(candidates[0].address).toBe(seller);
    expect(candidates[0].reason).toContain("claimable balance");
    expect(candidates.some(candidate => candidate.address === "GELIGIBLE")).toBe(false);
    expect(candidates.map(candidate => candidate.address)).toEqual([seller]);
  });

  it("ranks a four-million claimant ahead of the creator retaining one million", async () => {
    stubClaimableFlow([{ type: "claim_claimable_balance", balance_id: balanceId,
      source_account: seller, claimant: seller, transaction_successful: true }], { amount: "4000000" });
    const candidates = await inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal);
    expect(candidates.map(candidate => candidate.address)).toEqual([seller, intermediary]);
    expect(candidates[0].reason).toContain("4,000,000");
    expect(candidates[1].reason).toContain("Received 5,000,000");
    expect(candidates[1].reason).toContain("forwarded 4,000,000");
  });

  it("credits a repeatedly returned balance only once", async () => {
    stubClaimableFlow([{ type: "claim_claimable_balance", balance_id: balanceId,
      source_account: seller, claimant: seller, transaction_successful: true }], { amount: "4000000", duplicate: true });
    const candidates = await inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal);
    expect(candidates.map(candidate => candidate.address)).toEqual([seller, intermediary]);
    expect(candidates[0].reason).toContain("4,000,000");
  });

  it("preserves the creator's received amount when it claims its own balance", async () => {
    stubClaimableFlow([{ type: "claim_claimable_balance", balance_id: balanceId,
      source_account: intermediary, claimant: intermediary, transaction_successful: true }]);
    const candidates = await inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal);
    expect(candidates.map(candidate => candidate.address)).toEqual([intermediary]);
    expect(candidates[0].reason).toContain("Received 5,000,000");
    expect(candidates[0].reason).not.toContain("forwarded");
  });

  it("does not infer an eligible claimant without a successful claim of the matching balance", async () => {
    stubClaimableFlow([
      { type: "claim_claimable_balance", balance_id: "another-balance", source_account: seller, claimant: seller, transaction_successful: true },
      { type: "claim_claimable_balance", balance_id: balanceId, source_account: seller, claimant: seller, transaction_successful: false },
      { type: "clawback_claimable_balance", balance_id: balanceId, source_account: ISSUER, transaction_successful: true },
    ]);
    const candidates = await inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal);
    expect(candidates.map(candidate => candidate.address)).toEqual([intermediary]);
  });

  it.each([
    { source_account: seller },
    { transaction_successful: true },
    { transaction_successful: true, source_account: intermediary },
  ])("does not infer a claimant from incomplete or inconsistent proof %#", async fields => {
    stubClaimableFlow([{ type: "claim_claimable_balance", balance_id: balanceId, claimant: seller, ...fields }]);
    const candidates = await inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal);
    expect(candidates.map(candidate => candidate.address)).toEqual([intermediary]);
    expect(candidates[0].reason).not.toContain("forwarded");
  });

  it("does not trace a creation without explicit transaction success", async () => {
    stubClaimableFlow([{ type: "claim_claimable_balance", balance_id: balanceId, claimant: seller,
      source_account: seller, transaction_successful: true }], { unprovenCreation: true });
    const candidates = await inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal);
    expect(candidates.map(candidate => candidate.address)).toEqual([intermediary]);
  });

  it("keeps an unclaimed balance's eligible claimants out of the candidates", async () => {
    stubClaimableFlow([]);
    const candidates = await inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal);
    expect(candidates.map(candidate => candidate.address)).toEqual([intermediary]);
  });

  it("rejects creation effects for another asset instead of guessing a balance ID", async () => {
    stubClaimableFlow([], { wrongEffect: true });
    await expect(inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal))
      .rejects.toThrow("missing its balance ID");
  });

  it("rejects when the history limit is reached instead of returning partial candidates", async () => {
    stubClaimableFlow([], { endless: true });
    await expect(inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal))
      .rejects.toThrow("history exceeds 100 pages");
  });

  it("rejects a cancelled inference instead of returning partial candidates", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(inferDistribLite(HORIZON, "AFLWA", ISSUER, controller.signal))
      .rejects.toThrow();
  });

  it("finds claimable-balance creation after the first operations page", async () => {
    stubClaimableFlow([{ type: "claim_claimable_balance", balance_id: balanceId,
      source_account: seller, claimant: seller, transaction_successful: true }], { paginate: true });
    const candidates = await inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal);
    expect(candidates[0].address).toBe(seller);
  });

  it("surfaces unavailable claim history instead of returning the intermediate account", async () => {
    stubClaimableFlow([], { failClaims: true });
    await expect(inferDistribLite(HORIZON, "AFLWA", ISSUER, new AbortController().signal))
      .rejects.toThrow("Horizon request failed (410)");
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
