import { expect, test } from "@playwright/test";
import type { BeneficiaryGroup } from "@/lib/proceeds-investigator/beneficiaries";
const exchange = "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6";
const issuer = "GANJULEAUA7FO4G4VADKZGZ4R7BIRWFQWFCWD6D7W5UDV2D4TJ3CPYTQ";
const sellers = ["GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH", "GBVIJOWPN3YJUWFO6ZRDHLQOK24DQLV2VUXJ7FVSDRFNKKD5F3DDXGOS"];
function group(memoType: BeneficiaryGroup["memoType"] = "text", memoValue = "354151076", network = "public", transfers = [
  { operationId: "1", txHash: "tx-1", account: sellers[0], amountXlm: 3, createdAt: "2026-01-05T00:00:00Z" },
]): BeneficiaryGroup {
  return { network, address: exchange, memoType, memoValue, transfers, totalXlm: transfers.reduce((n, t) => n + t.amountXlm, 0), senders: [...new Set(transfers.map(t => t.account))] };
}
const analysis = (id: string, assetCode: string, groups?: BeneficiaryGroup[], network = "public", timestamp = 2) => ({ id, name: id, assetCode, issuer, network, timestamp, distribAddresses: sellers,
  result: { assetCode, issuer, accounts: sellers, totalAssetSold: 1, totalXlmProceeds: 2, totalOutgoingXlm: 3, estimatedOnHandXlm: -1,
    dexTradeCount: 1, pathSaleCount: 0, topDestinations: [], beneficiaryGrouping: groups ? { network, groups, unresolvedOperationCount: 0 } : undefined,
    coverage: { requestedFrom: null, requestedTo: "2026-01-06T00:00:00Z", complete: false, warnings: ["Fixture retained history only"] } },
});
test("Connections uses exact memo destinations, latest asset snapshots and unique operation evidence", async ({ page }) => {
  const secondTransfer = { operationId: "2", txHash: "tx-2", account: sellers[1], amountXlm: 4, createdAt: "2026-01-05T01:00:00Z" };
  const records = [analysis("a-new", "a", [group()]), analysis("b", "b", [group("text", "354151076", "public", [...group().transfers, secondTransfer]), group("id"), group("text", "0354151076")]),
    analysis("testnet", "a", [group("text", "354151076", "testnet")], "testnet"), analysis("old", "a", [group("text", "OLD-SNAPSHOT")], "public", 1), analysis("legacy", "legacy")];
  const writes: string[] = [];
  await page.route("**/api/db/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET" && path !== "/api/db/startup-sync") writes.push(path);
    return route.fulfill({ json: path === "/api/db/saved-analyses" ? records : [] });
  });
  await page.goto("/saved-analyses");
  await page.getByRole("tab", { name: "Connections", exact: true }).click();
  const section = page.getByRole("region", { name: "Beneficiary credit destinations" });
  await expect(section.getByText(/1 snapshot\(s\) have no memo grouping metadata/)).toBeVisible();
  await section.getByRole("button", { name: "Show beneficiary groups", exact: true }).click();
  await expect(section.locator("[data-beneficiary-group]")).toHaveCount(4);
  const common = section.locator("[data-beneficiary-group]").filter({ hasText: "2 sender(s)" });
  await expect(common.getByText("2 sender(s) · 2 operation(s) · 7 XLM transferred", { exact: true })).toBeVisible();
  await expect(common.getByText('Memo text: "354151076"', { exact: true })).toBeVisible();
  await expect(section.getByText('Memo id: "354151076"', { exact: true })).toBeVisible();
  await expect(section.getByText('Memo text: "0354151076"', { exact: true })).toBeVisible();
  await expect(section.getByText(/OLD-SNAPSHOT/)).toHaveCount(0);
  await common.getByText("Transaction evidence", { exact: true }).click();
  await expect(common.getByRole("link", { name: "View transaction", exact: true })).toHaveCount(2);
  await expect(section.getByText(/does not prove sender identity or common ownership/)).toBeVisible();
  expect(writes).toEqual([]);
});
