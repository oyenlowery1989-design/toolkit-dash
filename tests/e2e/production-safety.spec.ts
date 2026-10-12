import { expect, test } from "@playwright/test";

test("dashboard shows Horizon fee statistics", async ({ page }) => {
  await page.route("https://horizon.stellar.org/fee_stats", (route) => route.fulfill({
    json: { last_ledger_base_fee: "100", fee_charged: { p50: "110", p99: "200" } },
  }));
  await page.goto("/");
  await expect(page.getByText("p50 110 · p99 200")).toBeVisible();
});

test("the application exposes only Mainnet network controls", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Mainnet", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Testnet", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Futurenet", { exact: true })).toHaveCount(0);
});

test("database APIs reject non-mainnet automation configs", async ({ request }) => {
  const response = await request.post("/api/db/auto-send-groups", {
    data: { type: "group", id: "e2e-testnet", name: "blocked", network: "testnet", secretKey: "" },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ error: "Only mainnet is supported" });
});

test("authenticated health output reports fail-closed mainnet execution", async ({ request }) => {
  const response = await request.get("/api/admin/health");
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({
    provider: "sqlite",
    mainnet: { transactionsEnabled: false, emergencyStop: false },
  });
});

test("a failed backup request does not download an error as a backup", async ({ page }) => {
  await page.route("**/api/db/export", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: "Backup source read failed" }),
  }));
  await page.goto("/settings");
  await page.getByRole("button", { name: "Download Backup" }).click();
  await expect(page.getByText("Export failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Backup downloaded", { exact: true })).toHaveCount(0);
});

test("backup status warns when cloud keys exist but local sync is disabled", async ({ page }) => {
  await page.route("**/api/db/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      supabaseConfigured: true,
      supabaseOnly: false,
      localBackupEnabled: false,
      provider: "sqlite",
    }),
  }));
  await page.goto("/settings");
  await expect(page.getByText("Automatic backup is off — set SUPABASE_SYNC_USER_ID")).toBeVisible();
});

test("a recorded backup failure is visible in Settings", async ({ page }) => {
  await page.route("**/api/db/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      supabaseConfigured: true,
      supabaseOnly: false,
      localBackupEnabled: true,
      backupFailed: true,
      provider: "sqlite",
    }),
  }));
  await page.goto("/settings");
  await expect(page.getByText("Some local changes were not backed up.", { exact: false })).toBeVisible();
});
