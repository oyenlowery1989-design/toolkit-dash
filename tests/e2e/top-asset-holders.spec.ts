import { expect, test } from "@playwright/test";
const issuer = "GDAHP47TPZVR3CX45GAHLRJOOY6QV23HYSSVJ4NGR3P33ULLLJMST2KJ";
const addresses = ["GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH", "GBVIJOWPN3YJUWFO6ZRDHLQOK24DQLV2VUXJ7FVSDRFNKKD5F3DDXGOS", "GC67QDUVNVJBSNEI6FHPNGPDKUKZEZWNHVWT6E4L5XS5SYCKA2WAUTD6", "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6"];
const records = addresses.map((id, i) => ({ id, paging_token: id, balances: [{ asset_type: "credit_alphanum4", asset_code: "TRSY", asset_issuer: issuer, balance: String([10,40,20,30][i]) }] }));
test("top holders use the exact Lobstr asset and append manual sellers without starting an analysis", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/db/**", route => route.fulfill({ json: new URL(route.request().url()).pathname === "/api/db/bulk-scan-state" ? null : [] }));
  await page.route("https://horizon.stellar.org/**", route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: { _embedded: { records: url.pathname === "/assets" ? [{ asset_code: "TRSY", asset_issuer: issuer, claimable_balances_amount: "50", liquidity_pools_amount: "25", contracts_amount: "25" }] : records } } });
  });
  await page.goto("/asset-sales");
  await page.locator("#assets-input").fill(`https://lobstr.co/trade/TRSY:${issuer}`);
  await page.locator("#override-accounts").fill(addresses[0]);
  const section = page.getByRole("region", { name: "Top 3 asset holders" });
  await expect(section.getByRole("heading", { name: "Top 3 holders · TRSY" })).toBeVisible();
  expect(requests).toHaveLength(0);
  await section.getByRole("button", { name: "Check top 3 holders", exact: true }).click();
  await expect(section.locator("tbody tr")).toHaveCount(3);
  await expect(section.locator("tbody tr").first()).toContainText("40");
  await expect(section.locator("tbody tr").first()).toContainText("20.00%");
  await section.getByRole("button", { name: "Use as seller", exact: true }).first().click();
  await expect(page.locator("#override-accounts")).toHaveValue(`${addresses[0]}\n${addresses[1]}`);
  await expect(section.getByRole("button", { name: "Added", exact: true })).toBeDisabled();
  expect(requests.every(url => url.pathname === "/accounts" || url.pathname === "/assets")).toBe(true);
  expect(requests.find(url => url.pathname === "/accounts")!.searchParams.get("asset")).toBe(`TRSY:${issuer}`);
  await page.locator("#assets-input").fill(`WhipSim:${issuer}`);
  await expect(section.getByRole("heading", { name: "Top 3 holders · WhipSim" })).toBeVisible();
  await expect(section.locator("tbody tr")).toHaveCount(0);
});
test("stopping a holder check prevents its late response from publishing a ranking", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/db/**", route => route.fulfill({ json: new URL(route.request().url()).pathname === "/api/db/bulk-scan-state" ? null : [] }));
  await page.route("https://horizon.stellar.org/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/accounts") await gate;
    await route.fulfill({ json: { _embedded: { records: url.pathname === "/assets" ? [] : records } } });
  });
  await page.goto("/asset-sales");
  await page.locator("#assets-input").fill(`TRSY:${issuer}`);
  const section = page.getByRole("region", { name: "Top 3 asset holders" });
  await section.getByRole("button", { name: "Check top 3 holders", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run Analysis", exact: true })).toBeEnabled();
  await section.getByRole("button", { name: "Stop holder check", exact: true }).click();
  release();
  await expect(section.getByRole("button", { name: "Check top 3 holders", exact: true })).toBeVisible();
  await expect(section.locator("tbody tr")).toHaveCount(0);
  await expect(section.getByRole("alert")).toHaveCount(0);
});

test("slow supply metadata keeps holder ranking available with unknown percentages", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let supplyPending = false;
  await page.route("**/api/db/**", route => route.fulfill({ json: new URL(route.request().url()).pathname === "/api/db/bulk-scan-state" ? null : [] }));
  await page.route("https://horizon.stellar.org/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/assets") { supplyPending = true; await gate; }
    await route.fulfill({ json: { _embedded: { records: path === "/accounts" ? records : [] } } });
  });
  await page.goto("/asset-sales");
  await page.locator("#assets-input").fill(`TRSY:${issuer}`);
  await page.clock.install();
  const section = page.getByRole("region", { name: "Top 3 asset holders" });
  await section.getByRole("button", { name: "Check top 3 holders", exact: true }).click();
  await expect.poll(() => supplyPending).toBe(true);
  await expect(page.getByRole("button", { name: "Run Analysis", exact: true })).toBeEnabled();
  await page.clock.fastForward(5001);
  await expect(section.locator("tbody tr")).toHaveCount(3);
  await expect(section.getByText("Unknown", { exact: true })).toHaveCount(3);
  await expect(section.getByRole("button", { name: "Refresh top holders", exact: true })).toBeEnabled();
  release();
});

test("a holder can be saved as distributor only in the exact asset group, preserving other member roles", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  const matching = { id: "target", name: "TRSY group", assetCode: "TRSY", issuer, network: "public", createdAt: 1, updatedAt: 1,
    members: [{ id: "bank", groupId: "target", address: addresses[3], role: "bank", label: "Bank TRSY", addedAt: 1 }] };
  const groups = [{ ...matching, id: "wrong-case", assetCode: "trsy", members: [] }, { ...matching, id: "wrong-network", network: "testnet", members: [] }, matching];
  await page.route("**/api/db/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      if (path === "/api/db/groups") writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { id: "new-distributor" } });
    }
    return route.fulfill({ json: path === "/api/db/groups" ? groups : path === "/api/db/bulk-scan-state" ? null : [] });
  });
  await page.route("https://horizon.stellar.org/**", route => route.fulfill({ json: { _embedded: { records: new URL(route.request().url()).pathname === "/assets" ? [] : records } } }));
  await page.goto("/asset-sales");
  await page.locator("#assets-input").fill(`TRSY:${issuer}`);
  await expect(page.getByRole("link", { name: "Lobstr trade ↗", exact: true })).toHaveAttribute("href", `https://lobstr.co/trade/TRSY:${issuer}`);
  const section = page.getByRole("region", { name: "Top 3 asset holders" });
  await section.getByRole("button", { name: "Check top 3 holders", exact: true }).click();
  await expect(section.locator("tbody tr")).toHaveCount(3);
  await expect(section.locator("tbody tr").nth(1).getByRole("link", { name: "In group", exact: true })).toHaveAttribute("href", "/groups?open=target");
  await section.locator("tbody tr").first().getByRole("button", { name: "+ Distributor", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ type: "member", groupId: "target", address: addresses[1], role: "distributor" });
  await expect(section.getByRole("link", { name: "In group", exact: true })).toHaveCount(2);
  await expect(page.locator("#override-accounts")).toHaveValue("");
  await expect(page.getByText("Gross XLM sale output", { exact: true })).toHaveCount(0);
});
for (const tiny of [false, true]) {
  test(`sale price ${tiny ? "preserves sub-stroop ratios and code case" : "is absent without sold tokens"}`, async ({ page }) => {
    const result = { assetCode: "WhipSim", issuer, accounts: [], totalXlmProceeds: tiny ? 0.0000001 : 0, totalAssetSold: tiny ? 1000 : 0,
      totalOutgoingXlm: 0, estimatedOnHandXlm: 0, dexTradeCount: 0, pathSaleCount: 0, proceedsLedger: [], outgoingLedger: [], topDestinations: [] };
    await page.route("**/api/db/**", route => route.fulfill({ json: new URL(route.request().url()).pathname === "/api/db/bulk-scan-state"
      ? { rowsJson: JSON.stringify([{ assetCode: "WhipSim", issuer, status: "done", expanded: true, result }]), interrupted: false } : [] }));
    await page.goto("/asset-sales");
    await expect(page.getByRole("link", { name: "Open WhipSim on Lobstr", exact: true })).toHaveAttribute("href", `https://lobstr.co/trade/WhipSim:${issuer}`);
    if (tiny) await expect(page.getByText("1 WhipSim ≈ 0.0000000001 XLM · avg", { exact: true })).toBeVisible();
    else await expect(page.locator('[title^="Weighted average:"]')).toHaveCount(0);
  });
}
