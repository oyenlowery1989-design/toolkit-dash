import { expect, test } from "@playwright/test";
import { Keypair } from "stellar-sdk";

test("Address Balances completes, saves, and restores a scan", async ({ page }) => {
  const address = Keypair.random().publicKey();
  let savedRows: string | null = null;
  await page.route("**/api/db/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/bulk-scan-state")) {
      if (route.request().method() === "POST") {
        savedRows = route.request().postDataJSON().rowsJson;
        await route.fulfill({ json: { ok: true } });
      } else {
        await route.fulfill({ json: savedRows ? { rowsJson: savedRows, interrupted: false } : null });
      }
      return;
    }
    await route.fulfill({ json: route.request().method() === "GET" ? [] : { ok: true } });
  });
  await page.route(`https://horizon.stellar.org/accounts/${address}`, async (route) => {
    await route.fulfill({ json: {
      id: address, account_id: address, sequence: "1", subentry_count: 0,
      num_sponsoring: 0, num_sponsored: 0,
      balances: [{ asset_type: "native", balance: "100.0000000", selling_liabilities: "0" }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      signers: [{ key: address, weight: 1 }],
    } });
  });

  await page.goto("/address-balances");
  await page.locator("#addresses-input").fill(address);
  await page.getByRole("button", { name: "Check Balances" }).click();
  await expect(page.getByText("1 done · 0 failed")).toBeVisible();
  await expect.poll(() => JSON.parse(savedRows ?? "[]")[0]?.status).toBe("done");

  await page.reload();
  await expect(page.getByText("1 done · 0 failed")).toBeVisible();
  await expect(page.getByRole("cell", { name: "100", exact: true }).first()).toBeVisible();
});
