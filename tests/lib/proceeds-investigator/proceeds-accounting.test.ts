import { afterEach, describe, expect, it, vi } from "vitest";
import publicOperations from "../../fixtures/proceeds/vorix-path-operations.json";
import publicTrades from "../../fixtures/proceeds/vorix-path-trades.json";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";

const BASE = "https://horizon.example";
const A = "GSELLER", B = "GSELECTED", C = "GEXTERNAL", ISSUER = "GISSUER";
const DATE = "2026-01-05T00:00:00Z";
type Raw = Record<string, unknown>;
const page = (records: Raw[]) => ({ _embedded: { records } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const path = (id: string, overrides: Raw = {}): Raw => ({
  id, type: "path_payment_strict_send", created_at: DATE, transaction_hash: `tx-${id}`,
  transaction_successful: true, from: A, to: A,
  source_asset_type: "credit_alphanum4", source_asset_code: "TOK", source_asset_issuer: ISSUER,
  source_amount: "100", asset_type: "native", amount: "5", ...overrides,
});
const trade = (id: string, op: string, overrides: Raw = {}): Raw => ({
  id, ledger_close_time: DATE, base_account: A, counter_account: C,
  base_asset_type: "credit_alphanum4", base_asset_code: "TOK", base_asset_issuer: ISSUER,
  base_amount: "100", counter_asset_type: "native", counter_amount: "5",
  _links: { operation: { href: `${BASE}/operations/${op}` } }, ...overrides,
});
const payment = (id: string, to: string, amount = "3"): Raw => ({
  id, type: "payment", created_at: DATE, transaction_hash: `tx-${id}`, transaction_successful: true,
  from: A, to, asset_type: "native", amount,
});
function mockHorizon(config: {
  payments?: Record<string, Raw[]>; trades?: Record<string, Raw[]>; operations?: Record<string, Raw>;
  root?: Raw; ledger?: Raw; balances?: Record<string, Raw | number>;
  onFetch?: (url: URL) => void;
} = {}) {
  const mock = vi.fn(async (input: string | URL) => {
    const u = new URL(String(input));
    config.onFetch?.(u);
    if (u.pathname === "/") return json(config.root ?? { history_elder_ledger: 1 });
    if (u.pathname.startsWith("/ledgers/")) return json(config.ledger ?? {});
    if (u.pathname.startsWith("/operations/")) return json(config.operations?.[u.pathname.split("/")[2]] ?? {}, config.operations?.[u.pathname.split("/")[2]] ? 200 : 404);
    if (u.pathname === "/trades") return json(page(config.trades?.[u.searchParams.get("account_id")!] ?? []));
    const account = u.pathname.split("/")[2];
    if (u.pathname.endsWith("/payments")) return json(page(config.payments?.[account] ?? []));
    const balance = config.balances?.[account] ?? { balances: [{ asset_type: "native", balance: "11" }] };
    return typeof balance === "number" ? json({}, balance) : json(balance);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const run = (accounts = [A], signal = new AbortController().signal, from?: Date, options?: Parameters<typeof fetchAssetXlmProceeds>[8]) =>
  fetchAssetXlmProceeds(BASE, "TOK", ISSUER, accounts, signal, undefined, from, undefined, options);
afterEach(() => vi.unstubAllGlobals());

describe("proceeds operation accounting", () => {
  it.each(["payments", "trades"])("rejects malformed %s envelopes instead of claiming complete zero sales", async kind => {
    const original = mockHorizon();
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      if ((kind === "payments" && url.pathname.endsWith("/payments")) || (kind === "trades" && url.pathname === "/trades")) return json({});
      return original(input);
    });
    await expect(run()).rejects.toThrow(`Invalid ${kind} history response`);
  });

  it("counts an own direct path once and excludes own intermediate XLM", async () => {
    mockHorizon({ payments: { [A]: [path("p1"), path("p2", { asset_type: "credit_alphanum4", asset_code: "USD", asset_issuer: C })] },
      trades: { [A]: [trade("t1", "p1"), trade("t2", "p2")] } });
    const result = await run();
    expect(result.totalXlmProceeds).toBe(5);
    expect(result.totalAssetSold).toBe(100);
    expect(result.dexTradeCount).toBe(0);
    expect(result.pathSaleCount).toBe(1);
    expect(result.proceedsLedger[0]).toMatchObject({ operationId: "p1", txHash: "tx-p1" });
  });

  it("preserves maker fills within another sender's non-native-final path", async () => {
    mockHorizon({ trades: { [A]: [trade("maker", "other")] }, operations: {
      other: path("other", { from: C, to: C, asset_type: "credit_alphanum4", asset_code: "USD" }),
    } });
    const result = await run();
    expect(result.totalXlmProceeds).toBe(5);
    expect(result.dexTradeCount).toBe(1);
    expect(result.proceedsLedger[0].txHash).toBe("tx-other");
  });

  it("counts target path/direct purchases once, separating other-asset spend", async () => {
    const buying = { base_asset_type: "native", base_amount: "7", counter_asset_type: "credit_alphanum4",
      counter_asset_code: "TOK", counter_asset_issuer: ISSUER, counter_amount: "100" };
    mockHorizon({ payments: { [A]: [path("path-buy", { source_asset_type: "native", source_amount: "9",
      asset_type: "credit_alphanum4", asset_code: "TOK", asset_issuer: ISSUER })] },
      trades: { [A]: [trade("p-buy", "path-buy", buying), trade("d-buy", "direct-buy", buying),
        trade("other-buy", "direct-other", { ...buying, counter_asset_code: "OTHER" })] },
      operations: { "direct-buy": { type: "manage_sell_offer", transaction_hash: "buy-tx" },
        "direct-other": { type: "manage_buy_offer" } } });
    const result = await run();
    expect(result.totalXlmSpentOnPurchases).toBe(16);
    expect(result.accountWideXlmSpentOnPurchases).toBe(23);
    expect(result.purchaseLedger).toHaveLength(3);
    expect(result.totalOutgoingXlm).toBe(0);
    expect(result.topDestinations).toEqual([]);
  });

  it("excludes unrelated issuer/case, failed operations, and unrelated trade accounts", async () => {
    mockHorizon({ payments: { [A]: [path("bad-case", { source_asset_code: "tok" }), path("bad-issuer", { source_asset_issuer: C }),
      path("failed", { transaction_successful: false }), { ...payment("failed-pay", C), transaction_successful: false }] },
      trades: { [A]: [trade("wrong-case", "d1", { base_asset_code: "tok" }), trade("wrong-issuer", "d1", { base_asset_issuer: C }),
        trade("failed", "failed"), trade("not-me", "d1", { base_account: C, counter_account: B })] },
      operations: { failed: path("failed", { transaction_successful: false }) } });
    const result = await run();
    expect(result.totalXlmProceeds).toBe(0);
    expect(result.totalOutgoingXlm).toBe(0);
  });

  it("deduplicates accounts/events but preserves two operations in the same transaction", async () => {
    const p1 = path("p1", { transaction_hash: "shared" });
    const p2 = path("p2", { transaction_hash: "shared" });
    mockHorizon({ payments: { [A]: [p1, p1, p2] }, trades: { [A]: [trade("t1", "d1"), trade("t1", "d1"), trade("t2", "d2")] },
      operations: { d1: { type: "manage_sell_offer", transaction_hash: "shared" }, d2: { type: "manage_sell_offer", transaction_hash: "shared" } } });
    const result = await run([A, A]);
    expect(result.totalXlmProceeds).toBe(20);
    expect(result.totalAssetSold).toBe(400);
    expect(result.proceedsLedger).toHaveLength(4);
    expect(result.accountSummaries?.[0]).toMatchObject({ confirmedSeller: true, totalXlmProceeds: 20 });
  });

  it("separates selected-account transfers from external native sale delivery", async () => {
    const internal = payment("internal", B);
    mockHorizon({ payments: { [A]: [internal, internal, path("external-sale", { to: C }), payment("external", C, "2")],
      [B]: [internal, path("external-sale", { to: C })] } });
    const result = await run([A, B]);
    expect(result.totalXlmProceeds).toBe(5);
    expect(result.totalInternalTransferXlm).toBe(3);
    expect(result.totalOutgoingXlm).toBe(7);
    expect(result.externalSaleDeliveryXlm).toBe(5);
    expect(result.topDestinations).toEqual([{ address: C, totalXlm: 7, count: 2 }]);
    expect(result.internalTransferLedger).toHaveLength(1);
  });

  it("sums current balances, treats a missing merged account as zero and streams summaries", async () => {
    mockHorizon({ balances: { [A]: { balances: [{ asset_type: "native", balance: "12.345" }] }, [B]: 404 } });
    const summaries: unknown[] = [], logs: string[] = [];
    const result = await run([A, B], undefined, undefined, { onResult: (s) => summaries.push(s), onLog: (l) => logs.push(l) });
    expect(result.currentXlmBalance).toBe(12.345);
    expect(result.accountSummaries?.[1].currentXlmBalance).toBe(0);
    expect(summaries).toHaveLength(2);
    expect(logs).toContain(`  GET ${BASE}/accounts/${A}`);
    expect(result.coverage?.complete).toBe(true);
  });

  it("reports unavailable balance and retention without substituting historical arithmetic", async () => {
    mockHorizon({ root: {}, balances: { [A]: 400 } });
    const result = await run();
    expect(result.currentXlmBalance).toBeNull();
    expect(result.coverage?.complete).toBe(false);
    expect(result.coverage?.warnings.join(" ")).toContain("retention");
    expect(result.coverage?.warnings.join(" ")).toContain("balance unavailable");
  });

  it("checks the requested window against the server's retained ledger boundary", async () => {
    const config = { root: { history_elder_ledger: 123 }, ledger: { closed_at: "2026-01-01T00:00:00Z" } };
    mockHorizon(config);
    expect((await run([A], undefined, new Date("2026-01-02"))).coverage?.complete).toBe(true);
    mockHorizon(config);
    expect((await run([A], undefined, new Date("2025-01-02"))).coverage?.complete).toBe(false);
  });

  it("throws when aborted during a scan rather than returning apparently complete totals", async () => {
    const controller = new AbortController();
    mockHorizon({ onFetch: (url) => { if (url.pathname.endsWith("/payments")) controller.abort(); } });
    await expect(run([A], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("skips linked trades whose operation evidence is unavailable", async () => {
    mockHorizon({ trades: { [A]: [trade("unverified", "missing")] } });
    const result = await run();
    expect(result.totalXlmProceeds).toBe(0);
    expect(result.coverage?.complete).toBe(false);
    expect(result.coverage?.warnings.join(" ")).toContain("unverified trade skipped");
  });
});

it("recomputes the real VORIX path fixture from operation endpoints rather than intermediate fills", async () => {
  const seller = publicOperations[0].from;
  const targetIssuer = publicOperations[0].source_asset_issuer;
  mockHorizon({ payments: { [seller]: publicOperations }, trades: { [seller]: publicTrades } });
  const result = await fetchAssetXlmProceeds(BASE, "VORIX", targetIssuer, [seller], new AbortController().signal);
  const nativeEndpoints = publicOperations.filter((operation) => operation.asset_type === "native");
  const expectedProceeds = nativeEndpoints.reduce((total, operation) => total + Number(operation.amount), 0);
  const expectedSold = nativeEndpoints.reduce((total, operation) => total + Number(operation.source_amount), 0);
  expect(publicTrades.length).toBe(5);
  expect(result.totalXlmProceeds).toBeCloseTo(expectedProceeds, 7);
  expect(result.totalAssetSold).toBeCloseTo(expectedSold, 7);
  expect(result.totalXlmProceeds).toBeCloseTo(0.038805, 7);
  expect(result.totalAssetSold).toBeCloseTo(29.85, 7);
  expect(result.proceedsLedger.map((entry) => entry.operationId)).toEqual(["277867191298174977"]);
  expect(result.dexTradeCount).toBe(0);
  expect(result.pathSaleCount).toBe(1);
});

it("skips unlinked sales and purchases without confirming a seller", async () => {
  mockHorizon({ trades: { [A]: [trade("unlinked-sale", "unused", { _links: {} }),
    trade("unlinked-purchase", "unused", { _links: {}, base_asset_type: "native", base_amount: "4",
      counter_asset_type: "credit_alphanum4", counter_asset_code: "TOK", counter_asset_issuer: ISSUER })] } });
  const result = await run();
  expect(result.totalXlmProceeds).toBe(0);
  expect(result.totalXlmSpentOnPurchases).toBe(0);
  expect(result.accountWideXlmSpentOnPurchases).toBe(0);
  expect(result.accountSummaries?.[0].confirmedSeller).toBe(false);
  expect(result.coverage?.complete).toBe(false);
  expect(result.coverage?.warnings.join(" ")).toContain("lacks operation evidence");
});

it("breaks an A-to-B-to-A pagination cursor cycle without duplicating events", async () => {
  let paymentRequests = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/") return json({ history_elder_ledger: 1 });
    if (url.pathname.endsWith("/payments")) {
      const token = ["A", "B", "A"][paymentRequests++];
      if (paymentRequests > 3) throw new Error("Pagination cycle was not stopped");
      return json(page(Array.from({ length: 200 }, () => ({ ...payment("same-event", C), paging_token: token }))));
    }
    if (url.pathname === "/trades") return json(page([]));
    return json({ balances: [{ asset_type: "native", balance: "11" }] });
  }));
  const result = await run();
  expect(paymentRequests).toBe(3);
  expect(result.totalOutgoingXlm).toBe(3);
  expect(result.coverage?.complete).toBe(false);
  expect(result.coverage?.warnings.join(" ")).toContain("cursor cycle detected");
});

it.each([
  [new Date("invalid"), undefined],
  [undefined, new Date("invalid")],
  [new Date("2026-02-01"), new Date("2026-01-01")],
])("rejects an invalid date window before fetching (%s, %s)", async (from, to) => {
  const fetch = mockHorizon();
  await expect(fetchAssetXlmProceeds(BASE, "TOK", ISSUER, [A], new AbortController().signal,
    undefined, from, to)).rejects.toThrow("Invalid proceeds date window");
  expect(fetch).not.toHaveBeenCalled();
});

it("uses actual native-path destination receipt and excludes a self delivery", async () => {
  mockHorizon({ payments: { [A]: [
    path("native-external", { source_asset_type: "native", source_amount: "10", amount: "7", to: C }),
    path("native-self", { source_asset_type: "native", source_amount: "8", amount: "6", to: A }),
  ] } });
  const result = await run();
  expect(result.totalOutgoingXlm).toBe(7);
  expect(result.topDestinations).toEqual([{ address: C, totalXlm: 7, count: 1 }]);
  expect(result.outgoingLedger).toHaveLength(1);
  expect(result.outgoingLedger[0]).toMatchObject({ operationId: "native-external", amountXlm: 7 });
  expect(result.coverage?.warnings.join(" ")).toContain("consumed 10 XLM and delivered 7 XLM");
  expect(result.coverage?.warnings.join(" ")).toContain("consumed 8 XLM and delivered 6 XLM");
});
