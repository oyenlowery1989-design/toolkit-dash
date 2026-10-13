import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAddressInvestigation, fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
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
  it("does not mix case-distinct asset codes from the same issuer", async () => {
    stubHorizon({
      trades: [dexTrade()],
      payments: [pathSale()],
    });

    const result = await fetchAssetXlmProceeds(
      HORIZON,
      "WhipSim",
      ISSUER,
      [ACCOUNT],
      new AbortController().signal,
    );

    expect(result.totalAssetSold).toBe(0);
    expect(result.totalXlmProceeds).toBe(0);
  });

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

describe("fetchAddressInvestigation", () => {
  it("marks an unreadable account merge as incomplete and keeps other transfers", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/operations/op-merge-1/effects")) {
        return new Response("missing effects", { status: 404 });
      }
      if (path.endsWith(`/accounts/${ACCOUNT}/operations`)) {
        return json(page([
          accountMerge("merge-1", DEST_A),
          { ...xlmPayment("pay-1", DEST_B, "7"), created_at: "2026-01-03T00:00:00Z" },
        ]));
      }
      return json(page([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInvestigation(
      HORIZON,
      ACCOUNT,
      new AbortController().signal,
    );

    expect(result.complete).toBe(false);
    expect(result.warning).toContain("Account merge op-merge-1 amount unavailable");
    expect(result.totalOutgoingXlm).toBe(7);
    expect(result.outgoingLedger).toEqual([
      expect.objectContaining({ category: "payment", amountXlm: 7 }),
    ]);
  });

  it("requests failed transactions and includes their charged fees", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const request = new URL(String(url));
      if (request.pathname.endsWith(`/accounts/${ACCOUNT}/transactions`)) {
        if (request.searchParams.get("include_failed") !== "true") return json(page([]));
        return json(page([{
          hash: "failed-tx",
          paging_token: "failed-tx",
          created_at: "2026-01-03T00:00:00Z",
          fee_account: ACCOUNT,
          fee_charged: "10000",
          successful: false,
        }]));
      }
      return json(page([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInvestigation(
      HORIZON,
      ACCOUNT,
      new AbortController().signal,
    );

    expect(result.complete).toBe(true);
    expect(result.totalOutgoingXlm).toBeCloseTo(0.001, 7);
    expect(result.outgoingLedger).toEqual([
      expect.objectContaining({ category: "fee", successful: false, amountXlm: 0.001 }),
    ]);
  });

  it("scans newest first and stops both scans once records precede From", async () => {
    const from = new Date("2026-01-02T00:00:00Z");
    const to = new Date("2026-01-03T23:59:59Z");
    const newer = Array.from({ length: 197 }, (_, index) => ({
      ...xlmPayment(`new-${index}`, DEST_A, "1"),
      created_at: "2026-01-04T00:00:00Z",
    }));
    const operationRecords = [
      ...newer,
      { ...xlmPayment("within-3", DEST_A, "3"), created_at: "2026-01-03T00:00:00Z" },
      { ...xlmPayment("within-2", DEST_A, "2"), created_at: "2026-01-02T00:00:00Z" },
      { ...xlmPayment("older", DEST_A, "99"), created_at: "2026-01-01T00:00:00Z" },
    ];
    const feeRecord = (hash: string, createdAt: string) => ({
      hash,
      paging_token: hash,
      created_at: createdAt,
      fee_account: ACCOUNT,
      fee_charged: "10000000",
      successful: true,
    });
    const transactionRecords = [
      ...Array.from({ length: 197 }, (_, index) => feeRecord(`new-${index}`, "2026-01-04T00:00:00Z")),
      feeRecord("within-3", "2026-01-03T00:00:00Z"),
      feeRecord("within-2", "2026-01-02T00:00:00Z"),
      feeRecord("older", "2026-01-01T00:00:00Z"),
    ];
    const operationRequests: URL[] = [];
    const transactionRequests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const request = new URL(String(url));
      if (request.pathname.endsWith(`/accounts/${ACCOUNT}/operations`)) {
        operationRequests.push(request);
        return json(page(operationRecords));
      }
      if (request.pathname.endsWith(`/accounts/${ACCOUNT}/transactions`)) {
        transactionRequests.push(request);
        return json(page(transactionRecords));
      }
      return json(page([]));
    }));

    const result = await fetchAddressInvestigation(
      HORIZON,
      ACCOUNT,
      new AbortController().signal,
      undefined,
      from,
      to,
    );

    expect(result.complete).toBe(true);
    expect(result.totalOutgoingXlm).toBe(7);
    expect(operationRequests).toHaveLength(1);
    expect(transactionRequests).toHaveLength(1);
    expect(operationRequests[0].searchParams.get("order")).toBe("desc");
    expect(transactionRequests[0].searchParams.get("order")).toBe("desc");
  });
});
