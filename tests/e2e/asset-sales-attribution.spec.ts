import { expect, test } from "@playwright/test";
const issuer = "GANJULEAUA7FO4G4VADKZGZ4R7BIRWFQWFCWD6D7W5UDV2D4TJ3CPYTQ";
const exchange = "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6";
const sellers = ["GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH", "GBVIJOWPN3YJUWFO6ZRDHLQOK24DQLV2VUXJ7FVSDRFNKKD5F3DDXGOS"];
for (const mode of ["automatic", "saved", "manual", "historical lookup"] as const) {
  test(`${mode} selection scans every chosen seller and preserves provenance`, async ({ page }) => {
    const horizonUrls: URL[] = [];
    const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
    let releaseGroups!: () => void;
    const groupGate = new Promise<void>(resolve => { releaseGroups = resolve; });
    const groups = (mode === "saved" || mode === "historical lookup") ? [{ id: "saved-group", name: "Saved sellers", assetCode: "Token", issuer, network: "public", createdAt: 1, updatedAt: 1,
      members: sellers.map((address, i) => ({ id: String(i), groupId: "saved-group", address, role: "distributor", addedAt: 1 })) }] : [];
    await page.route("**/api/db/**", async route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        writes.push({ url: url.pathname, body });
        await route.fulfill({ json: { ok: true } }); return;
      }
      if (url.pathname === "/api/db/groups") {
        if (mode === "saved") await groupGate;
        await route.fulfill({ json: groups }); return;
      }
      if (url.pathname === "/api/db/bulk-scan-state") { await route.fulfill({ json: null }); return; }
      await route.fulfill({ json: [] });
    });
    await page.route("**/api.coingecko.com/**", route => route.fulfill({ json: { stellar: { usd: 0.2 } } }));
    await page.route("https://horizon.stellar.org/**", async route => {
      const url = new URL(route.request().url());horizonUrls.push(url);
      if (url.pathname === "/") { await route.fulfill({ json: { history_elder_ledger: 1 } }); return; }
      if (url.pathname === "/trades") {
        const account = url.searchParams.get("account_id")!;const index = sellers.indexOf(account);
        await route.fulfill({ json: { _embedded: { records: index < 0 ? [] : [{ id: `trade-${index}`, operation_id: `sale-${index}`, ledger_close_time: "2026-01-05T00:00:00Z", base_account: account, counter_account: issuer,
          base_asset_type: "credit_alphanum4", base_asset_code: "Token", base_asset_issuer: issuer, base_amount: "10", counter_asset_type: "native", counter_amount: String(index + 3) }] } } });return;
      }
      if (url.pathname.startsWith("/operations/sale-")) { await route.fulfill({ json: { type: "manage_sell_offer", transaction_successful: true, transaction_hash: "synthetic-sale-proof" } });return; }
      if (url.pathname === `/accounts/${issuer}/payments`) {
        await route.fulfill({ json: { _embedded: { records: sellers.map((to, i) => ({ id: String(i+10), paging_token: String(i+10), type: "payment", from: issuer, to, asset_code: "Token", asset_issuer: issuer, amount: String(i+1), transaction_successful: true })) } } });return;
      }
      const paymentAccount = sellers.find(account => url.pathname === `/accounts/${account}/payments`);
      if (paymentAccount) {
        const index = sellers.indexOf(paymentAccount);
        await route.fulfill({ json: { _embedded: { records: [{ id: `transfer-${index}`, type: "payment", transaction_successful: true, transaction_hash: `memo-tx-${index}`, created_at: "2026-01-05T00:00:00Z", from: paymentAccount, to: exchange, asset_type: "native", amount: String(index + 2) }] } } }); return;
      }
      if (url.pathname.startsWith("/transactions/memo-tx-")) { await route.fulfill({ json: { hash: url.pathname.split("/").at(-1), successful: true, memo_type: "text", memo: "354151076" } }); return; }
      if (url.pathname.endsWith("/payments") || url.pathname.endsWith("/operations")) { await route.fulfill({ json: { _embedded: { records: [] } } });return; }
      await route.fulfill({ json: { home_domain: "", balances: [{ asset_type: "native", balance: "11" }] } });
    });
    await page.goto(mode === "historical lookup" ? "/asset-lookup" : "/asset-sales");
    if (mode === "historical lookup") {
      await page.locator("#asset-code").fill("Token");
      await page.locator("#issuer").fill(issuer);
    } else await page.locator("#assets-input").fill(`Token:${issuer}`);
    if (mode === "manual") await page.locator("#override-accounts").fill(sellers.join("\n"));
    if (mode === "saved") {
      await expect(page.getByRole("button", { name: "Run Analysis", exact: true })).toBeDisabled();
      expect(horizonUrls).toHaveLength(0);
      releaseGroups();
    }
    const runButton = page.getByRole("button", { name: mode === "historical lookup" ? "Distribution Sales" : "Run Analysis", exact: true });
    await runButton.click();
    if (mode === "historical lookup") await expect(page.getByText("Distribution Sales — XLM Proceeds", { exact: true })).toBeVisible();
    if (mode !== "historical lookup") await expect(page.getByText("1 done · 0 failed")).toBeVisible();
    await expect(page.getByText("Confirmed asset → XLM seller", { exact: false })).toHaveCount(2);
    await expect(page.getByText("Gross XLM sale output", { exact: true })).toBeVisible();
    const beneficiaries = page.getByRole("region", { name: "Beneficiary credit destinations" });
    await beneficiaries.getByRole("button", { name: "Show beneficiary groups", exact: true }).click();
    await expect(beneficiaries.locator("[data-beneficiary-group]")).toHaveCount(1);
    await expect(beneficiaries.getByText('Memo text: "354151076"', { exact: true })).toBeVisible();
    await expect(beneficiaries.getByText("2 sender(s) · 2 operation(s) · 5 XLM transferred", { exact: true })).toBeVisible();
    await expect(beneficiaries.getByText(/does not prove sender identity or common ownership/)).toBeVisible();
    await expect.poll(() => writes.filter(w => w.url === "/api/db/saved-analyses").length).toBe(1);
    const save = writes.find(w => w.url === "/api/db/saved-analyses")!.body;
    expect((save.distribAddresses as string[]).sort()).toEqual([...sellers].sort());
    const result = save.result as { totalXlmProceeds: number; sellerAttributions: Array<{ source: string; confirmedSeller: boolean }> };
    expect(result.totalXlmProceeds).toBe(7);
    expect(result.sellerAttributions.every(a => a.source === (mode === "automatic" ? "inferred" : mode === "manual" ? "manual" : "saved") && a.confirmedSeller)).toBe(true);
    expect(horizonUrls.some(u => u.pathname === `/accounts/${issuer}/payments`)).toBe(mode === "automatic");
    expect(new Set(horizonUrls.filter(u => u.pathname === "/trades").map(u => u.searchParams.get("account_id")))).toEqual(new Set(sellers));
  });
}
