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
  const balances = new Map<string, string>();
  await page.route("https://horizon.stellar.org/**", async route => {
    expect(route.request().method()).toBe("GET");
    const url = route.request().url();
    if (new URL(url).pathname.startsWith("/accounts/")) {
      if (!process.env.TRSY_BUYERS_LIVE_BALANCES) return route.fulfill({ json: { balances: [{ asset_type: "native", balance: "0.0000000" }] } });
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const data = await response.json();
      const balance = data.balances.find((entry: { asset_type: string }) => entry.asset_type === "native").balance;
      balances.set(new URL(url).pathname.split("/").at(-1)!, Number(balance).toLocaleString("en-US", { maximumFractionDigits: 7 }));
      return route.fulfill({ response });
    }
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
    if (process.env.TRSY_BUYERS_LIVE_BALANCES) {
      await expect.poll(() => balances.get(expected.buyers[0].address)).toBeTruthy();
      await expect(section.locator("tbody tr").first().locator("td").nth(2)).toHaveText(balances.get(expected.buyers[0].address)!);
      console.info(`TRSY ${period}: ${expected.buyers[0].address} spent ${expected.buyers[0].xlmSpent} XLM; current ${balances.get(expected.buyers[0].address)} XLM`);
    }
    await expect(page.getByRole("button", { name: "Run Analysis", exact: true })).toBeEnabled();
  }
  await section.locator("tbody tr").first().getByRole("button", { name: /^View purchases for/ }).click();
  await expect(section.getByRole("region", { name: "Verified purchase evidence" }).getByRole("link").first())
    .toHaveAttribute("href", `https://stellar.expert/explorer/public/tx/${live.results["7d"].buyers[0].evidence[0].txHash}`);
  if (process.env.TRSY_BUYERS_LIVE_BALANCES) {
    await section.getByRole("button", { name: "Sort by current XLM", exact: true }).click();
    const buyers = live.results["7d"].buyers;
    await expect(section.getByText(new RegExp(`Balances checked: ${buyers.length} / ${buyers.length}`))).toBeVisible({ timeout: 60_000 });
    const expected = [...buyers].sort((a, b) => Number(balances.get(b.address)!.replaceAll(",", "")) - Number(balances.get(a.address)!.replaceAll(",", "")))[0];
    const first = section.locator("tbody tr").first();
    await expect(first.locator("td").nth(0)).toContainText(`${expected.address.slice(0, 4)}…${expected.address.slice(-4)}`);
    await expect(first.locator("td").nth(1)).toHaveText(expected.xlmSpent);
    await expect(first.locator("td").nth(2)).toHaveText(balances.get(expected.address)!);
    console.info(`TRSY balance ranking: ${buyers.length} accounts checked; highest ${expected.address}, current ${balances.get(expected.address)} XLM; historical spent ${expected.xlmSpent} XLM`);
  }
  await section.getByRole("heading", { name: "Top Verified Buyers · TRSY" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/trsy-top-verified-buyers.jpg" });
});
