import { expect, test } from "@playwright/test";

const issuer = "GDAHP47TPZVR3CX45GAHLRJOOY6QV23HYSSVJ4NGR3P33ULLLJMST2KJ";
const seller = "GCDTWPDFESYQQ6YSPVEMRLIHQ4HLMKIOFO6RNZMNWVRUWXJJLIAB4AZI";
const buyers = ["GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH", "GBVIJOWPN3YJUWFO6ZRDHLQOK24DQLV2VUXJ7FVSDRFNKKD5F3DDXGOS", "GC67QDUVNVJBSNEI6FHPNGPDKUKZEZWNHVWT6E4L5XS5SYCKA2WAUTD6"];
const dates = ["2026-10-15T12:00:00Z", "2026-09-25T12:00:00Z", "2026-09-01T12:00:00Z"];
const trade = (index: number, date = dates[index]) => ({
  id: `${100 + index}-0`, paging_token: `${100 + index}-0`, ledger_close_time: date,
  base_account: buyers[index], counter_account: seller, base_asset_type: "native", base_amount: String([10, 30, 100][index]),
  counter_asset_type: "credit_alphanum4", counter_asset_code: "TRSY", counter_asset_issuer: issuer, counter_amount: String([20, 60, 200][index]),
  _links: { operation: { href: `https://horizon.stellar.org/operations/${100 + index}` } },
});
const operation = (index: number, date = dates[index]) => ({ id: String(100 + index), type: "manage_buy_offer", created_at: date,
  source_account: buyers[index], transaction_successful: true, transaction_hash: String(index + 1).repeat(64) });

test("buyers are opt-in, ranked by spending with independent 7/30/all periods and proof", async ({ page }) => {
  const writes: string[] = [], requests: URL[] = [];
  await page.route("**/api/db/**", route => {
    if (route.request().method() !== "GET") writes.push(route.request().url());
    return route.fulfill({ json: new URL(route.request().url()).pathname === "/api/db/bulk-scan-state" ? null : [] });
  });
  await page.route("https://horizon.stellar.org/**", route => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url());requests.push(url);
    if (url.pathname === "/") return route.fulfill({ json: { history_elder_ledger: 1 } });
    if (url.pathname === "/trades") return route.fulfill({ json: { _embedded: { records: [0, 1, 2].map(i => trade(i)) } } });
    if (url.pathname.startsWith("/operations/")) return route.fulfill({ json: operation(Number(url.pathname.split("/").at(-1)) - 100) });
    return route.fulfill({ json: { _embedded: { records: [] } } });
  });
  await page.goto("/asset-sales");
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
  const section = page.getByRole("region", { name: "Top Verified Buyers", exact: true });
  await expect(section).toHaveCount(0);
  await page.locator("#assets-input").fill(`TRSY:${issuer}`);
  await expect(section.getByRole("button", { name: "7 days", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(requests).toHaveLength(0);
  await section.getByRole("button", { name: "Check verified buyers", exact: true }).click();
  await expect(section.getByRole("button", { name: "Refresh buyers", exact: true })).toBeVisible();
  await expect(section.locator("tbody tr")).toHaveCount(1);
  await expect(section.locator("tbody tr").first()).toContainText("10.0000000");
  await expect(page.getByRole("button", { name: "Run Analysis", exact: true })).toBeEnabled();
  await section.getByRole("button", { name: "30 days", exact: true }).click();
  await expect(section.locator("tbody tr")).toHaveCount(2);
  await expect(section.locator("tbody tr").first()).toContainText("30.0000000");
  await section.getByRole("button", { name: "All history", exact: true }).click();
  await expect(section.locator("tbody tr")).toHaveCount(3);
  await expect(section.locator("tbody tr").first()).toContainText("100.0000000");
  await section.getByRole("button", { name: "View purchases for GC67…UTD6", exact: true }).click();
  const proof = section.getByRole("region", { name: "Verified purchase evidence", exact: true });
  await expect(proof.getByRole("link")).toHaveAttribute("href", `https://stellar.expert/explorer/public/tx/${"3".repeat(64)}`);
  expect(writes.filter(url => url.includes("saved-analyses"))).toEqual([]);
  expect(requests.every(url => url.pathname === "/" || url.pathname === "/trades" || url.pathname.startsWith("/operations/"))).toBe(true);
  await page.locator("#assets-input").fill(`wTRSY:${issuer}`);
  await expect(section.getByRole("heading", { name: "Top Verified Buyers · wTRSY" })).toBeVisible();
  await expect(section.locator("tbody tr")).toHaveCount(0);
});

test("stopping retains verified partial buyers, ignores late results and leaves analysis runnable", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pending = false;
  await page.route("**/api/db/**", route => route.fulfill({ json: new URL(route.request().url()).pathname === "/api/db/bulk-scan-state" ? null : [] }));
  await page.route("https://horizon.stellar.org/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ json: { history_elder_ledger: 1 } });
    if (path === "/trades") return route.fulfill({ json: { _embedded: { records: [trade(0), trade(1, dates[0])] } } });
    if (path.endsWith("/101")) { pending = true;await gate; }
    return route.fulfill({ json: operation(path.endsWith("/101") ? 1 : 0, dates[0]) });
  });
  await page.goto("/asset-sales");
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
  await page.locator("#assets-input").fill(`TRSY:${issuer}`);
  const section = page.getByRole("region", { name: "Top Verified Buyers", exact: true });
  await section.getByRole("button", { name: "Check verified buyers", exact: true }).click();
  await expect.poll(() => pending).toBe(true);
  await expect(section.locator("tbody tr")).toHaveCount(1);
  await section.getByRole("button", { name: "Stop buyer check", exact: true }).click();
  release();
  await expect(section.getByText("Buyer check stopped. Retained results are partial.", { exact: true })).toBeVisible();
  await expect(section.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Run Analysis", exact: true })).toBeEnabled();
});

test("retention gaps remain visible when coverage details are collapsed", async ({ page }) => {
  await page.route("**/api/db/**", route => route.fulfill({ json: new URL(route.request().url()).pathname === "/api/db/bulk-scan-state" ? null : [] }));
  await page.route("https://horizon.stellar.org/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ json: { history_elder_ledger: 123 } });
    if (path === "/ledgers/123") return route.fulfill({ json: { closed_at: "2026-10-14T00:00:00Z" } });
    if (path === "/trades") return route.fulfill({ json: { _embedded: { records: [trade(0)] } } });
    return route.fulfill({ json: operation(0) });
  });
  await page.goto("/asset-sales");
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
  await page.locator("#assets-input").fill(`TRSY:${issuer}`);
  const section = page.getByRole("region", { name: "Top Verified Buyers", exact: true });
  await section.getByRole("button", { name: "30 days", exact: true }).click();
  await section.getByRole("button", { name: "Check verified buyers", exact: true }).click();
  await expect(section.getByRole("button", { name: "Refresh buyers", exact: true })).toBeVisible();
  await expect(section.getByText("Coverage limited or unverified — details (1)", { exact: true })).toBeVisible();
  await expect(section.locator("details")).not.toHaveAttribute("open", "");
  await expect(section.locator("tbody tr")).toHaveCount(1);
});
