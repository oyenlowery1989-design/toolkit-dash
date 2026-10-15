import { expect, test } from "@playwright/test";
import trsy from "../fixtures/proceeds/trsy-history-creation.json";

test("TRSY retained creation removes the generic warning and exposes bounded coverage proof", async ({ page }) => {
  await page.route("**/api/db/**", route => route.fulfill({ json: new URL(route.request().url()).pathname === "/api/db/bulk-scan-state" ? null : [] }));
  await page.route("**/api.coingecko.com/**", route => route.fulfill({ json: { stellar: { usd: 0.2 } } }));
  await page.route("https://horizon.stellar.org/**", route => {
    expect(route.request().method()).toBe("GET");
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ json: trsy.root });
    if (path.startsWith("/ledgers/")) return route.fulfill({ json: trsy.ledger });
    if (path === `/accounts/${trsy.account}/payments`) return route.fulfill({ json: { _embedded: { records: [trsy.creation] } } });
    if (path === "/trades") return route.fulfill({ json: { _embedded: { records: [] } } });
    return route.fulfill({ json: { balances: [{ asset_type: "native", balance: "8" }] } });
  });
  await page.goto("/asset-sales");
  await page.locator("#assets-input").fill(`${trsy.assetCode}:${trsy.issuer}`);
  await page.locator("#override-accounts").fill(trsy.account);
  await page.getByRole("button", { name: "Run Analysis", exact: true }).click();
  await expect(page.getByText("1 done · 0 failed", { exact: true })).toBeVisible();
  const details = page.locator("[data-analysis-details]");
  await expect(details.getByText("History incomplete", { exact: true })).toHaveCount(0);
  await details.getByText("Analysis details", { exact: true }).click();
  await expect(details.getByText("History covered since observed account creation", { exact: true })).toBeVisible();
  await expect(details.getByRole("link", { name: "Creation proof", exact: true })).toHaveAttribute("href", `https://stellar.expert/explorer/public/tx/${trsy.creation.transaction_hash}`);
  await expect(details.getByText("Selected accounts only; earlier account incarnations are unverified.", { exact: true })).toBeVisible();
});
