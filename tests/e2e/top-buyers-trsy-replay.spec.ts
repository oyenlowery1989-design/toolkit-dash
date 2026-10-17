import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Public GET captures from a live engine run; opt-in so normal CI never depends on Horizon.
test("real TRSY GET capture reproduces the buyer ranking and all period filters in the UI", async ({ page }) => {
  test.skip(!process.env.TRSY_BUYERS_REPLAY, "Set TRSY_BUYERS_REPLAY to the public live-capture directory.");
  test.setTimeout(180_000);
  const directory = process.env.TRSY_BUYERS_REPLAY!;
  const cache = JSON.parse(await readFile(`${directory}/trsy-top-buyers-live-responses.json`, "utf8"));
  const live = JSON.parse(await readFile(`${directory}/trsy-top-buyers-live-results.json`, "utf8"));
  const issuer = "GDAHP47TPZVR3CX45GAHLRJOOY6QV23HYSSVJ4NGR3P33ULLLJMST2KJ";
  await page.route("**/api/db/**", route => route.fulfill({ json: new URL(route.request().url()).pathname === "/api/db/bulk-scan-state" ? null : [] }));
  await page.route("https://horizon.stellar.org/**", route => {
    expect(route.request().method()).toBe("GET");
    const url = route.request().url();
    expect(cache[url], `Missing public GET capture: ${url}`).toBeDefined();
    return route.fulfill({ json: cache[url] });
  });
  await page.goto("/asset-sales");
  await page.clock.install({ time: new Date(live.started) });
  await page.locator("#assets-input").fill(`TRSY:${issuer}`);
  const section = page.getByRole("region", { name: "Top Verified Buyers", exact: true });
  for (const [period, label] of [["all", "All history"], ["30d", "30 days"], ["7d", "7 days"]]) {
    await section.getByRole("button", { name: label, exact: true }).click();
    if (period === "all") await section.getByRole("button", { name: "Check verified buyers", exact: true }).click();
    await expect(section.getByRole("button", { name: "Refresh buyers", exact: true })).toBeVisible({ timeout: 90_000 });
    const expected = live.results[period];
    await expect(section.getByText(new RegExp(`${expected.buyers.length} verified buyers`))).toBeVisible();
    await expect(section.locator("tbody tr").first()).toContainText(expected.buyers[0].xlmSpent);
    await expect(section.locator("tbody tr").first()).toContainText(expected.buyers[0].assetBought);
    await expect(page.getByRole("button", { name: "Run Analysis", exact: true })).toBeEnabled();
  }
  await section.locator("tbody tr").first().getByRole("button", { name: /^View purchases for/ }).click();
  await expect(section.getByRole("region", { name: "Verified purchase evidence" }).getByRole("link").first())
    .toHaveAttribute("href", `https://stellar.expert/explorer/public/tx/${live.results["7d"].buyers[0].evidence[0].txHash}`);
  await section.getByRole("heading", { name: "Top Verified Buyers · TRSY" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/trsy-top-verified-buyers.jpg" });
});
