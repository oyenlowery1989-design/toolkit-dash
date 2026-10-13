import { readFileSync } from "node:fs";
import { transpileModule, ScriptTarget } from "typescript";
import { expect, it, vi } from "vitest";

// Exercise the actual closure bodies without introducing a DOM test dependency.
function closure(file: string, start: string, end: string, name: string, scope: Record<string, unknown>) {
  const source = readFileSync(file, "utf8");
  const block = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const js = transpileModule(`${block}\nreturn ${name};`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), js)(...Object.values(scope));
}

it("ignores aborted Asset Lookup enrichment data and loading settlement", async () => {
  const controller = new AbortController();
  let finish!: (result: unknown) => void;
  const setPaymentTotals = vi.fn();
  const setPaymentTotalsLoading = vi.fn();
  const handler = closure("components/asset-lookup/AssetLookupPanel.tsx", "  const handleFetchPaymentTotals =", "  const handleFetchClaimable =", "handleFetchPaymentTotals", {
    paymentTotalsLoading: false, showPaymentTotals: false, paymentTotals: null,
    setShowPaymentTotals: vi.fn(), setPaymentTotalsLoading, setPaymentTotalsError: vi.fn(),
    abortRef: { current: controller }, settings: {}, resolveHorizonUrl: () => "https://horizon.example",
    Horizon: { Server: class {} }, distribCandidates: [], issuer: "GI", assetCode: "USD",
    fetchPaymentTotals: () => new Promise(resolve => { finish = resolve; }), setPaymentTotals,
  });
  const pending = handler();
  controller.abort();
  finish({ stale: true });
  await pending;
  expect(setPaymentTotals).not.toHaveBeenCalled();
  expect(setPaymentTotalsLoading.mock.calls).toEqual([[true]]);
});

it("pins Transactions pagination to the searched account", async () => {
  const forAccount = vi.fn();
  const builder = { operations: () => builder, forAccount: (address: string) => { forAccount(address); return builder; }, order: () => builder, limit: () => builder, includeFailed: () => builder, cursor: () => builder, call: async () => ({ records: [] }) };
  const fetchPage = closure("app/(tools)/transactions/page.tsx", "  async function fetchPage(", "  const handleSearch =", "fetchPage", {
    Horizon: { Server: class { constructor() { return builder; } } }, resolveHorizonUrl: () => "https://horizon.example", settings: {}, PAGE_SIZE: 50, mapOperation: (op: unknown) => op,
    accountId: "GEDITED",
  });
  await fetchPage("GSEARCHED", "123");
  expect(forAccount).toHaveBeenCalledWith("GSEARCHED");
  const source = readFileSync("app/(tools)/transactions/page.tsx", "utf8");
  expect(source).toContain("await fetchPage(searchedAccount, lastPagingToken)");
});

it("does not overwrite a replacement balance row or apply an aborted recheck", () => {
  let rows = [{ address: "GNEW", status: "pending" }];
  const save = vi.fn();
  const updateRow = closure("components/address-balances/AddressBalancesPanel.tsx", "  const updateRow =", "  const fetchRowInto =", "updateRow", {
    setRows: (update: (prev: typeof rows) => typeof rows) => { rows = update(rows); }, scanState: { save },
  });
  const controller = new AbortController();
  updateRow(0, "GOLD", controller.signal, { status: "done" });
  expect(rows[0]).toEqual({ address: "GNEW", status: "pending" });
  controller.abort();
  updateRow(0, "GNEW", controller.signal, { status: "done" });
  expect(rows[0].status).toBe("pending");
  const source = readFileSync("components/address-balances/AddressBalancesPanel.tsx", "utf8");
  expect(source).toContain("const controller = abortRef.current;\n    await fetchRowInto(index, address, horizonUrl, controller.signal)");
});
