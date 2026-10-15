import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import fixture from "../../fixtures/proceeds/gbvi-soroban-sale.json";
const op = fixture.operation;
const account = op.source_account;
const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
type Raw = Record<string, unknown>;
function mock(payments: Raw[] = [op], trades: Raw[] = []) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/") return Response.json({ history_elder_ledger: 1 });
    if (url.pathname.endsWith("/payments")) return Response.json({ _embedded: { records: payments } });
    if (url.pathname === "/trades") return Response.json({ _embedded: { records: trades } });
    return Response.json({ balances: [{ asset_type: "native", balance: "11" }] });
  });
}
const run = (code = "USDC", assetIssuer = issuer) => fetchAssetXlmProceeds("https://horizon.example", code, assetIssuer, [account], new AbortController().signal);
const token = (from: string, to: string, amount = "1") => ({ type: "transfer", from, to, amount, asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: issuer });
const native = (from: string, to: string, amount = "5") => ({ type: "transfer", from, to, amount, asset_type: "native" });
afterEach(() => vi.unstubAllGlobals());
describe("verified Soroban conversion endpoints", () => {
  it("counts the real GBVI USDC sale once from account endpoints, matching independent ledger effects", async () => {
    mock();
    const result = await run();
    const effects = fixture.effects._embedded.records;
    const credit = effects.find(e => e.type === "account_credited" && e.asset_type === "native" && e.account === account)!;
    const debit = effects.find(e => e.type === "account_debited" && e.asset_code === "USDC" && e.asset_issuer === issuer && e.account === account)!;
    expect(result.totalXlmProceeds).toBe(Number(credit.amount));
    expect(result.totalAssetSold).toBe(Number(debit.amount));
    expect(result.proceedsLedger).toHaveLength(1);
    expect(result.proceedsLedger[0]).toMatchObject({ category: "contract_sale", operationId: op.id, txHash: op.transaction_hash, account });
    expect(result.contractSaleCount).toBe(1);
    expect(result.dexTradeCount).toBe(0); expect(result.pathSaleCount).toBe(0);
    expect(result.totalOutgoingXlm).toBe(0);
  });
  it("does not count duplicate operations or contract mirrors as classic trade proceeds", async () => {
    mock([op, op], [{ id: "trade-mirror", operation_id: op.id, ledger_close_time: op.created_at, base_account: account, counter_account: "other", base_asset_type: "credit_alphanum4", base_asset_code: "USDC", base_asset_issuer: issuer, base_amount: "999", counter_asset_type: "native", counter_amount: "999" }]);
    const result = await run();
    expect(result.proceedsLedger).toHaveLength(1);
    expect(result.proceedsLedger[0].category).toBe("contract_sale");
    expect(result.dexTradeCount).toBe(0);
  });
  it("keeps native purchases separate from transfers and target sales", async () => {
    mock([{ ...op, asset_balance_changes: [native(account, "contract"), token("contract", account)] }]);
    const result = await run();
    expect(result.totalXlmSpentOnPurchases).toBe(5);
    expect(result.accountWideXlmSpentOnPurchases).toBe(5);
    expect(result.totalXlmProceeds).toBe(0); expect(result.totalOutgoingXlm).toBe(0);
    expect(result.purchaseLedger?.[0].category).toBe("contract_purchase");
    const other = await run("OTHER");
    expect(other.totalXlmSpentOnPurchases).toBe(0); expect(other.accountWideXlmSpentOnPurchases).toBe(5);
  });
  it("excludes intermediate XLM between contracts and preserves exact asset identity", async () => {
    mock([{ ...op, asset_balance_changes: [token(account, "contract-a"), native("contract-a", "contract-b"), { ...token("contract-b", account), asset_code: "EURC" }] }]);
    expect((await run()).totalXlmProceeds).toBe(0);
    mock();
    expect((await run("usdc")).totalXlmProceeds).toBe(0);
    expect((await run("USDC", "other-issuer")).totalXlmProceeds).toBe(0);
  });
  it.each([
    [token(account, "contract"), token("contract", account, "0.9"), native("contract", account)],
    [token(account, "contract"), { ...token(account, "contract"), asset_code: "OTHER" }, native("contract", account)],
    [token(account, "contract"), { ...native("contract", account), amount: "not-an-amount" }],
  ])("marks ambiguous or malformed endpoints incomplete without netting them into profit", async (...changes) => {
    mock([{ ...op, asset_balance_changes: changes }]);
    const result = await run();
    expect(result.totalXlmProceeds).toBe(0);
    expect(result.coverage?.complete).toBe(false);
    expect(result.coverage?.warnings.join(" ")).toContain("Contract");
  });
  it("does not silently claim complete coverage when contract balance evidence is missing", async () => {
    mock([{ ...op, asset_balance_changes: undefined }]);
    expect((await run()).coverage?.complete).toBe(false);
  });
  it("does not count failed contract operations", async () => {
    mock([{ ...op, transaction_successful: false }]);
    expect((await run()).totalXlmProceeds).toBe(0);
  });
});

it.each(["debit-destination", "credit-source", "success"])("rejects unverified contract evidence with missing %s", async field => {
  const changes = op.asset_balance_changes.map(change => ({ ...change } as Record<string, unknown>));
  if (field === "debit-destination") delete changes.find(change => change.from === account)!.to;
  if (field === "credit-source") delete changes.find(change => change.to === account && change.asset_type === "native")!.from;
  mock([{ ...op, transaction_successful: field === "success" ? undefined : true, asset_balance_changes: changes }]);
  const result = await run();
  expect(result.totalXlmProceeds).toBe(0);
  expect(result.coverage?.complete).toBe(false);
});
