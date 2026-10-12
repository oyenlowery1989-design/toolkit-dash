import { expect, test } from "@playwright/test";
import { Keypair } from "stellar-sdk";

test("Run All reviews every payment and sends only after approval", async ({ page }) => {
  const sender = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const groups = ["one", "two"].map((id) => ({
    id, name: `Group ${id}`, network: "public", secretKey: "", hasKey: true,
    intervalMinutes: null, enabled: false, batchSend: true, minReserve: 10,
    minSenderThreshold: 0, previewOnly: false, createdAt: 1,
    destinations: [{ id: `dest-${id}`, groupId: id, destination, percentage: 100, isRemainder: false, paused: false, minThreshold: 0, maxCap: 0, position: 0 }],
  }));
  let sends = 0;
  await page.route("**/api/db/auto-send-groups", (route) => route.fulfill({ json: groups }));
  await page.route("**/api/auto-send/scheduler-status", (route) => route.fulfill({ json: { serverless: false } }));
  await page.route("**/api/auto-send/stats", (route) => route.fulfill({ json: { totalRuns: 0, activeGroups: 0 } }));
  await page.route("**/api/auto-send/history?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/auto-send/run", async (route) => {
    const body = route.request().postDataJSON();
    if (body.dryRun) {
      await route.fulfill({ json: {
        groupId: body.groupId, walletAddress: sender, xlmBalance: 100, spendable: 89,
        batchSend: true, estimatedFees: 0.00001, previewToken: `token-${body.groupId}`, safetyWarnings: [],
        items: [{ destination, percentage: 100, isRemainder: false, amountXlm: 89, wouldSkip: false }],
      } });
      return;
    }
    expect(body.previewToken).toBe(`token-${body.groupId}`);
    sends++;
    await route.fulfill({ json: { groupId: body.groupId, walletAddress: sender, ranAt: Date.now(), results: [{ destination, status: "sent", amountSent: 89 }] } });
  });
  await page.goto("/auto-send-groups");
  await page.getByRole("button", { name: "Run All" }).click();
  await expect(page.getByRole("dialog", { name: "Review all payments" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Group one")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Group two")).toBeVisible();
  expect(sends).toBe(0);
  await page.getByRole("button", { name: "Approve & send all" }).click();
  await expect.poll(() => sends).toBe(2);
});
