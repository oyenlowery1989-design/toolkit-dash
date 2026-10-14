import { expect, test } from "@playwright/test";

test("older analyses stay accessible and full snapshots load only when opened", async ({ page }) => {
  const records = Array.from({ length: 61 }, (_, i) => ({
    id: `snapshot-${String(i).padStart(3, "0")}`, name: `Audit asset ${i}`,
    assetCode: `a${i}`, issuer: "GDBIXGZ3EKI3M4DBM65ADLHVNYIOG7JXGOHW5DHUZQAXPORY3QNO2PNY",
    distribAddresses: [], network: "public", timestamp: 1000 - i,
    result: { assetCode: `a${i}`, issuer: "GISSUER", accounts: [], totalAssetSold: 1, totalXlmProceeds: 2,
      totalOutgoingXlm: 0, estimatedOnHandXlm: 2, dexTradeCount: 1, pathSaleCount: 0, topDestinations: [] },
    graphOutgoing: [], hasOutgoingLedger: false,
  }));
  const details: string[] = [];
  await page.route("**/api/db/saved-analyses*", async (route) => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get("id");
    if (id) {
      details.push(id);
      const record = records.find((r) => r.id === id)!;
      await route.fulfill({ json: { ...record, result: { ...record.result, proceedsLedger: [], outgoingLedger: [] } } });
      return;
    }
    const before = url.searchParams.get("beforeId");
    const start = before ? records.findIndex((r) => r.id === before) + 1 : 0;
    const rows = records.slice(start, start + 20).map((record) => ({ ...record }));
    if (start + rows.length < records.length) Object.assign(rows.at(-1)!, { nextCursor: { timestamp: rows.at(-1)!.timestamp, id: rows.at(-1)!.id } });
    await route.fulfill({ json: rows });
  });
  await page.goto("/saved-analyses");
  await expect(page.getByText("61 assets", { exact: true })).toBeVisible();
  expect(details).toEqual([]);
  await page.getByRole("button", { name: /^Load All/ }).click();
  await expect(page.getByText("Audit asset 60", { exact: true })).toBeVisible();
  expect(details).toEqual([]);
  await page.getByText("Audit asset 60", { exact: true }).click();
  await expect.poll(() => details).toEqual(["snapshot-060"]);
  await expect(page.getByText("Loading snapshot details…", { exact: true })).toHaveCount(0);
});

test("serverless Auto-Send offers manual scheduling only", async ({ page }) => {
  await page.route("**/api/auto-send/scheduler-status", (route) => route.fulfill({ json: { serverless: true, started: false, scheduledGroups: 0 } }));
  await page.goto("/auto-send-groups");
  await expect(page.getByText(/scheduled auto-sends are disabled/)).toBeVisible();
  await page.getByRole("button", { name: /New Group|Add Group/ }).first().click();
  await expect(page.getByRole("button", { name: "Manual", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "1h", exact: true })).toHaveCount(0);
});
