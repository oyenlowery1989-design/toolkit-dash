import { expect, test } from "@playwright/test";
import sale from "../fixtures/proceeds/gbvi-soroban-sale.json";
import memo from "../fixtures/proceeds/gbvi-exchange-memos.json";

test("public GBVI records expose contract proceeds and exact memo evidence together", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/db/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      if (path === "/api/db/saved-analyses") writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: path === "/api/db/bulk-scan-state" ? null : [] });
  });
  await page.route("**/api.coingecko.com/**", route => route.fulfill({ json: { stellar: { usd: 0.2 } } }));
  await page.route("https://horizon.stellar.org/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ json: { history_elder_ledger: 1 } });
    if (url.pathname === `/accounts/${memo.account}/payments`) return route.fulfill({ json: { _embedded: { records: [sale.operation, ...memo.payments] } } });
    if (url.pathname === "/trades") return route.fulfill({ json: { _embedded: { records: [] } } });
    if (url.pathname.startsWith("/transactions/")) return route.fulfill({ json: memo.transactions.find(tx => tx.hash === url.pathname.split("/").at(-1)) });
    return route.fulfill({ json: { balances: [{ asset_type: "native", balance: "0" }] } });
  });
  await page.goto("/asset-sales");
  await page.locator("#assets-input").fill("USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
  await page.locator("#override-accounts").fill(memo.account);
  await page.getByRole("button", { name: "Run Analysis", exact: true }).click();
  await expect(page.getByText("1 done · 0 failed", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 contract conversion\(s\)/)).toBeVisible();
  await expect(page.getByText(/Confirmed asset → XLM seller/)).toBeVisible();
  const beneficiaries = page.getByRole("region", { name: "Beneficiary credit destinations" });
  await beneficiaries.getByRole("button", { name: "Show beneficiary groups", exact: true }).click();
  await expect(beneficiaries.getByText('Memo text: "354151076"', { exact: true })).toBeVisible();
  await expect(beneficiaries.getByText(/1 sender\(s\) · 3 operation\(s\)/)).toBeVisible();
  await expect.poll(() => writes.length).toBe(1);
  const result = writes[0].result as { totalXlmProceeds: number; totalAssetSold: number; contractSaleCount: number; dexTradeCount: number; beneficiaryGrouping: { groups: Array<{ totalXlm: number }> } };
  const credit = sale.effects._embedded.records.find(effect => effect.type === "account_credited" && effect.asset_type === "native" && effect.account === memo.account)!;
  expect(result.totalXlmProceeds).toBe(Number(credit.amount));
  expect(result.contractSaleCount).toBe(1); expect(result.dexTradeCount).toBe(0);
  expect(result.beneficiaryGrouping.groups[0].totalXlm).toBe(memo.payments.reduce((total, op) => total + Number(op.amount), 0));
});
