import { expect, test } from "@playwright/test";

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
