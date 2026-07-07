import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import type { ScanProgress } from "@/lib/proceeds-investigator/types";

const HORIZON = "https://horizon.example.com";
const ASSET_CODE = "WHIPSIM";
const ISSUER = "GISSUER00000000000000000000000000000000000000000000AB";
const ACCOUNT = "GACCOUNT0000000000000000000000000000000000000000000CD";
const DEST_A = "GDESTA0000000000000000000000000000000000000000000000A";
const DEST_B = "GDESTB0000000000000000000000000000000000000000000000B";
const DEST_C = "GDESTC0000000000000000000000000000000000000000000000C";

/** Wrap records in Horizon's paginated `_embedded.records` envelope. A short
 *  page (< FETCH_LIMIT=200 records) is what the scanners use to terminate. */
function page(records: unknown[]) {
  return { _embedded: { records }, _links: {} };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Route a stubbed global fetch by URL substring. Every unmatched URL returns
 *  an empty page so any endpoint the scanners touch terminates cleanly. */
function stubHorizon(routes: {
  trades?: unknown[];
  payments?: unknown[];
  effects?: Record<string, unknown[]>;
}) {
  const f = vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/effects")) {
      // /operations/{opId}/effects — pick the matching op fixture
      const opId = u.split("/operations/")[1]?.split("/effects")[0] ?? "";
      return json(page(routes.effects?.[opId] ?? []));
    }
    if (u.includes("/trades")) return json(page(routes.trades ?? []));
    if (u.includes("/payments")) return json(page(routes.payments ?? []));
    return json(page([]));
  });
  vi.stubGlobal("fetch", f);
  return f;
}

// ---- Fixture builders (minimal Horizon-shaped records) ----

function dexTrade(overrides: Record<string, unknown> = {}) {
  return {
    id: "trade-1",
    paging_token: "pt-trade-1",
    ledger_close_time: "2026-01-01T00:00:00Z",
    base_account: ACCOUNT,
    base_asset_type: "credit_alphanum12",
    base_asset_code: ASSET_CODE,
    base_asset_issuer: ISSUER,
    base_amount: "100",
    counter_asset_type: "native",
    counter_amount: "50",
    ...overrides,
  };
}

function pathSale(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-path-1",
    paging_token: "pt-path-1",
    type: "path_payment_strict_send",
    created_at: "2026-01-02T00:00:00Z",
    transaction_hash: "hash-path-1",
    transaction_successful: true,
    from: ACCOUNT,
    to: DEST_A,
    source_asset_type: "credit_alphanum12",
    source_asset_code: ASSET_CODE,
    source_asset_issuer: ISSUER,
    source_amount: "40",
    asset_type: "native",
    amount: "20",
    ...overrides,
  };
}

function xlmPayment(id: string, to: string, amount: string) {
  return {
    id: `op-${id}`,
    paging_token: `pt-${id}`,
    type: "payment",
    created_at: "2026-01-03T00:00:00Z",
    transaction_hash: `hash-${id}`,
    transaction_successful: true,
    from: ACCOUNT,
    to,
    asset_type: "native",
    amount,
  };
}

function accountMerge(id: string, into: string) {
  return {
    id: `op-${id}`,
    paging_token: `pt-${id}`,
    type: "account_merge",
    created_at: "2026-01-04T00:00:00Z",
    transaction_hash: `hash-${id}`,
    transaction_successful: true,
    source_account: ACCOUNT,
    into,
  };
}

function mergeEffect(into: string, amount: string) {
  return [
    {
      type: "account_credited",
      asset_type: "native",
      account: into,
      amount,
    },
  ];
}

afterEach(() => vi.restoreAllMocks());

describe("fetchAssetXlmProceeds", () => {
  it("computes totals, on-hand, and destination aggregation from mocked Horizon", async () => {
    stubHorizon({
      trades: [dexTrade()],
      payments: [
        pathSale(),
        xlmPayment("pay-1", DEST_A, "10"),
        xlmPayment("pay-2", DEST_A, "5"),
        xlmPayment("pay-3", DEST_B, "3"),
        accountMerge("merge-1", DEST_C),
      ],
      effects: { "op-merge-1": mergeEffect(DEST_C, "25") },
    });

    const result = await fetchAssetXlmProceeds(
      HORIZON,
      ASSET_CODE,
      ISSUER,
      [ACCOUNT],
      new AbortController().signal,
    );

    // Asset sold: 100 (DEX) + 40 (path sale)
    expect(result.totalAssetSold).toBeCloseTo(140, 7);
    // XLM proceeds: 50 (DEX) + 20 (path sale)
    expect(result.totalXlmProceeds).toBeCloseTo(70, 7);
    // Outgoing: 10 + 5 + 3 (payments) + 25 (merge)
    expect(result.totalOutgoingXlm).toBeCloseTo(43, 7);
    // On-hand = proceeds - outgoing = 70 - 43
    expect(result.estimatedOnHandXlm).toBeCloseTo(27, 7);

    expect(result.dexTradeCount).toBe(1);
    expect(result.pathSaleCount).toBe(1);
    expect(result.accounts).toEqual([ACCOUNT]);
  });

  it("aggregates same-destination payments, keeps distinct ones separate, sorts desc", async () => {
    stubHorizon({
      payments: [
        xlmPayment("pay-1", DEST_A, "10"),
        xlmPayment("pay-2", DEST_A, "5"),
        xlmPayment("pay-3", DEST_B, "3"),
        accountMerge("merge-1", DEST_C),
      ],
      effects: { "op-merge-1": mergeEffect(DEST_C, "25") },
    });

    const { topDestinations } = await fetchAssetXlmProceeds(
      HORIZON,
      ASSET_CODE,
      ISSUER,
      [ACCOUNT],
      new AbortController().signal,
    );

    // Two payments to DEST_A collapse into one entry (sum=15, count=2)
    const a = topDestinations.find((d) => d.address === DEST_A);
    expect(a).toMatchObject({ totalXlm: 15, count: 2 });

    const b = topDestinations.find((d) => d.address === DEST_B);
    expect(b).toMatchObject({ totalXlm: 3, count: 1 });

    const c = topDestinations.find((d) => d.address === DEST_C);
    expect(c).toMatchObject({ totalXlm: 25, count: 1 });

    // Sorted by totalXlm descending: DEST_C (25) > DEST_A (15) > DEST_B (3)
    expect(topDestinations.map((d) => d.address)).toEqual([
      DEST_C,
      DEST_A,
      DEST_B,
    ]);
  });

  it("lets estimatedOnHandXlm go negative when outgoing exceeds proceeds (no clamp)", async () => {
    stubHorizon({
      trades: [dexTrade({ base_amount: "1", counter_amount: "5" })], // 5 XLM proceeds
      payments: [xlmPayment("pay-1", DEST_A, "20")], // 20 XLM outgoing
    });

    const result = await fetchAssetXlmProceeds(
      HORIZON,
      ASSET_CODE,
      ISSUER,
      [ACCOUNT],
      new AbortController().signal,
    );

    expect(result.totalXlmProceeds).toBeCloseTo(5, 7);
    expect(result.totalOutgoingXlm).toBeCloseTo(20, 7);
    expect(result.estimatedOnHandXlm).toBeCloseTo(-15, 7);
    expect(result.estimatedOnHandXlm).toBeLessThan(0);
  });

  it("fires onProgress with populated phase and records", async () => {
    stubHorizon({
      trades: [dexTrade()],
      payments: [xlmPayment("pay-1", DEST_A, "10")],
    });

    const progress: ScanProgress[] = [];
    await fetchAssetXlmProceeds(
      HORIZON,
      ASSET_CODE,
      ISSUER,
      [ACCOUNT],
      new AbortController().signal,
      (p) => progress.push(p),
    );

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some((p) => typeof p.phase === "string" && p.phase.length > 0)).toBe(true);
    expect(progress.every((p) => typeof p.records === "number")).toBe(true);
  });

  it("returns an empty (zeroed) result without fetching when signal is already aborted", async () => {
    const f = stubHorizon({
      trades: [dexTrade()],
      payments: [xlmPayment("pay-1", DEST_A, "10")],
    });

    const controller = new AbortController();
    controller.abort();

    const result = await fetchAssetXlmProceeds(
      HORIZON,
      ASSET_CODE,
      ISSUER,
      [ACCOUNT],
      controller.signal,
    );

    // Aborted-before-start short-circuits the account loop: resolves (does not
    // reject/hang) with a zeroed result and never touches the network.
    expect(f).not.toHaveBeenCalled();
    expect(result.totalAssetSold).toBe(0);
    expect(result.totalXlmProceeds).toBe(0);
    expect(result.totalOutgoingXlm).toBe(0);
    expect(result.estimatedOnHandXlm).toBe(0);
    expect(result.topDestinations).toEqual([]);
  });
});
