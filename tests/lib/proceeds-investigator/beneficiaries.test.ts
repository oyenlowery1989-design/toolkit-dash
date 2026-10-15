import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../fixtures/proceeds/beneficiary-memos.json";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import { groupBeneficiaries, readTransactionMemo } from "@/lib/proceeds-investigator/beneficiaries";
import { summarizeSavedAnalysis } from "@/lib/saved-analyses/summary";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import type { ProceedsLedgerEntry } from "@/lib/proceeds-investigator/types";
const entry = (id: string, memo = { type: "text" as const, value: "354151076" }, overrides: Partial<ProceedsLedgerEntry> = {}): ProceedsLedgerEntry => ({
  id, operationId: id, account: "seller-a", from: "seller-a", to: fixture.exchange,
  txHash: `tx-${id}`, category: "payment", successful: true, createdAt: "2026-01-05T00:00:00Z", amountXlm: 3, memo, ...overrides,
});
afterEach(() => vi.unstubAllGlobals());
describe("exact beneficiary credit destinations", () => {
  it("groups matching tuples, combines senders and deduplicates operations across analyses", () => {
    const groups = groupBeneficiaries([
      { network: "public", entries: [entry("1"), entry("2", undefined, { account: "seller-b", from: "seller-b" })] },
      { network: "public", entries: [entry("1"), entry("3", undefined, { txHash: "tx-1" })] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ network: "public", address: fixture.exchange, memoType: "text", memoValue: "354151076", totalXlm: 9 });
    expect(groups[0].transfers).toHaveLength(3);
    expect(groups[0].senders).toEqual(["seller-a", "seller-b"]);
    expect(new Set(groups[0].transfers.map(e => e.operationId))).toEqual(new Set(["1", "2", "3"]));
  });
  it("keeps network, recipient, memo type and exact value distinct", () => {
    const entries = fixture.transactions.map((tx, i) => entry(String(i), undefined, { memo: readTransactionMemo(tx) }));
    const groups = groupBeneficiaries([
      { network: "public", entries: [...entries, entry("other-destination", undefined, { to: "other" }), entry("case", { type: "text", value: "AbC" }), entry("lower", { type: "text", value: "abc" })] },
      { network: "testnet", entries: [entry("other-network")] },
    ]);
    expect(groups).toHaveLength(9);
    expect(groups.find(g => g.memoType === "text" && g.memoValue === "354151076" && g.network === "public" && g.address === fixture.exchange)?.transfers).toHaveLength(2);
    expect(groups.some(g => g.memoType === "none" && g.memoValue === null)).toBe(true);
  });
  it("never treats missing or malformed metadata as a known no-memo destination", () => {
    for (const tx of [{}, { memo_type: "id", memo: 354151076 }, { memo_type: "text" }, { memo_type: "none", memo: "unexpected" }, { memo_type: "id", memo: "18446744073709551616" }, { memo_type: "text", memo: "354151076", memo_bytes: "b3RoZXI=" }]) expect(readTransactionMemo(tx)).toBeUndefined();
    expect(readTransactionMemo({ memo_type: "text", memo: "" })).toEqual({ type: "text", value: "" });
    expect(readTransactionMemo({ memo_type: "id", memo: "18446744073709551615" })).toEqual({ type: "id", value: "18446744073709551615" });
    const digest = btoa("a".repeat(32));
    expect(readTransactionMemo({ memo_type: "hash", memo: digest })).toEqual({ type: "hash", value: digest });
    expect(readTransactionMemo({ memo_type: "return", memo: digest })).toEqual({ type: "return", value: digest });
    expect(groupBeneficiaries([{ network: "public", entries: [entry("unknown", undefined, { memo: undefined }), entry("failed", undefined, { successful: false }), entry("zero", undefined, { amountXlm: 0 })] }])).toEqual([]);
  });
  it("preserves exact grouping metadata through JSON and lightweight saved summaries", () => {
    const entries = Array.from({ length: 61 }, (_, i) => entry(String(i), { type: "text", value: String(i).padStart(3, "0") }));
    const groups = groupBeneficiaries([{ network: "public", entries }]);
    const analysis = JSON.parse(JSON.stringify({ id: "snapshot", distribAddresses: ["seller-a"], result: { proceedsLedger: [], outgoingLedger: entries, topDestinations: [], beneficiaryGrouping: { network: "public", groups, unresolvedOperationCount: 0 } } })) as SavedAnalysis;
    const summary = summarizeSavedAnalysis(analysis);
    expect(summary.result.outgoingLedger).toBeUndefined();
    expect(summary.result.beneficiaryGrouping?.groups).toEqual(groups);
    expect(summary.result.beneficiaryGrouping?.groups).toHaveLength(61);
    expect(summary.result.beneficiaryGrouping?.groups.some(g => g.memoValue === "000")).toBe(true);
  });
  it("never merges hash and return memos or Unicode-normalizes text", () => {
    const digest = btoa("a".repeat(32));
    const memos = [{ type: "hash", value: digest }, { type: "return", value: digest }, { type: "text", value: "é" }, { type: "text", value: "e\u0301" }] as const;
    expect(groupBeneficiaries([{ network: "public", entries: memos.map((memo, i) => entry(String(i), undefined, { memo })) }])).toHaveLength(4);
  });
});

describe("transaction memo enrichment", () => {
  it("fetches one verified transaction per hash, retains all operations and preserves proceeds totals", async () => {
    const fetch = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/") return Response.json({ history_elder_ledger: 1 });
      if (url.pathname.endsWith("/payments")) return Response.json({ _embedded: { records: ["1", "2"].map(id => ({ id, paging_token: id, type: "payment", transaction_successful: true, transaction_hash: "tx-text-a", created_at: "2026-01-05T00:00:00Z", from: "seller-a", to: fixture.exchange, asset_type: "native", amount: "3" })) } });
      if (url.pathname === "/trades") return Response.json({ _embedded: { records: [] } });
      if (url.pathname === "/transactions/tx-text-a") return Response.json(fixture.transactions[0]);
      return Response.json({ balances: [{ asset_type: "native", balance: "11" }] });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchAssetXlmProceeds("https://horizon.example", "TOK", "issuer", ["seller-a"], new AbortController().signal, undefined, undefined, undefined, { network: "public" });
    expect(result.totalOutgoingXlm).toBe(6);
    expect(result.totalXlmProceeds).toBe(0);
    expect(result.beneficiaryGrouping).toMatchObject({ network: "public", unresolvedOperationCount: 0 });
    expect(result.beneficiaryGrouping?.groups[0]).toMatchObject({ memoValue: "354151076", totalXlm: 6 });
    expect(result.outgoingLedger.every(e => e.memo?.type === "text")).toBe(true);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/transactions/"))).toHaveLength(1);
  });
  it.each(["missing", "mismatched", "failed", "malformed", "aborted"])("handles %s transaction metadata without inventing a group", async mode => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/") return Response.json({ history_elder_ledger: 1 });
      if (url.pathname.endsWith("/payments")) return Response.json({ _embedded: { records: [{ id: "1", type: "payment", transaction_successful: true, transaction_hash: "tx-missing", created_at: "2026-01-05T00:00:00Z", from: "seller-a", to: fixture.exchange, asset_type: "native", amount: "3" }] } });
      if (url.pathname === "/trades") return Response.json({ _embedded: { records: [] } });
      if (url.pathname.startsWith("/transactions/")) {
        if (mode === "aborted") controller.abort();
        if (mode === "missing") return Response.json({}, { status: 404 });
        return Response.json({ hash: mode === "mismatched" ? "wrong" : "tx-missing", successful: mode !== "failed", memo_type: mode === "malformed" ? "bogus" : "none" });
      }
      return Response.json({ balances: [{ asset_type: "native", balance: "11" }] });
    });
    const run = fetchAssetXlmProceeds("https://horizon.example", "TOK", "issuer", ["seller-a"], controller.signal, undefined, undefined, undefined, { network: "public" });
    if (mode === "aborted") await expect(run).rejects.toThrow();
    else {
      const result = await run;
      expect(result.totalOutgoingXlm).toBe(3);
      expect(result.beneficiaryGrouping).toMatchObject({ groups: [], unresolvedOperationCount: 1 });
      expect(result.coverage?.complete).toBe(true);
    }
  });
});

it("preserves a leading Unicode BOM instead of conflating it with plain text", () => {
  const value = "\uFEFFabc";
  expect(readTransactionMemo({ memo_type: "text", memo: value, memo_bytes: btoa(String.fromCharCode(...new TextEncoder().encode(value))) })).toEqual({ type: "text", value });
  expect(groupBeneficiaries([{ network: "public", entries: [entry("bom", { type: "text", value }), entry("plain", { type: "text", value: "abc" })] }])).toHaveLength(2);
});

it("keeps distinct muxed recipients separate from each other and the exchange base address", () => {
  const groups = groupBeneficiaries([{ network: "public", entries: [
    entry("muxed-a", undefined, { toMuxed: "MMUXED-A", toMuxedId: "1" }),
    entry("muxed-b", undefined, { toMuxed: "MMUXED-B", toMuxedId: "2" }),
    entry("base"),
    entry("missing-muxed-address", undefined, { toMuxedId: "3" }),
  ] }]);
  expect(groups).toHaveLength(3);
  expect(groups.find(g => g.address === "MMUXED-A")?.baseAddress).toBe(fixture.exchange);
  expect(groups.map(g => g.address).sort()).toEqual([fixture.exchange, "MMUXED-A", "MMUXED-B"].sort());
});

it.each([true, false])("preserves muxed operation metadata during scanning (full address: %s)", async fullAddress => {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/") return Response.json({ history_elder_ledger: 1 });
    if (url.pathname.endsWith("/payments")) return Response.json({ _embedded: { records: ["1", "2"].map(id => ({ id, type: "payment", transaction_successful: true, transaction_hash: "tx-text-a", created_at: "2026-01-05T00:00:00Z", from: "seller-a", to: fixture.exchange, to_muxed: fullAddress ? `MMUXED-${id}` : undefined, to_muxed_id: id, asset_type: "native", amount: "3" })) } });
    if (url.pathname === "/trades") return Response.json({ _embedded: { records: [] } });
    if (url.pathname === "/transactions/tx-text-a") return Response.json(fixture.transactions[0]);
    return Response.json({ balances: [{ asset_type: "native", balance: "11" }] });
  });
  const result = await fetchAssetXlmProceeds("https://horizon.example", "TOK", "issuer", ["seller-a"], new AbortController().signal, undefined, undefined, undefined, { network: "public" });
  expect(result.totalOutgoingXlm).toBe(6);
  expect(result.topDestinations).toEqual([{ address: fixture.exchange, totalXlm: 6, count: 2 }]);
  expect(result.outgoingLedger.map(e => e.toMuxedId)).toEqual(["1", "2"]);
  expect(result.beneficiaryGrouping?.groups).toHaveLength(fullAddress ? 2 : 0);
  expect(result.beneficiaryGrouping?.unresolvedOperationCount).toBe(fullAddress ? 0 : 2);
});
