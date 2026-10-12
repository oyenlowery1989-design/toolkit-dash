import { expect, test, type Page } from "@playwright/test";
import { Keypair, Networks, TransactionBuilder } from "stellar-sdk";

const signer = Keypair.random();
const destination = Keypair.random().publicKey();
const savedWallet = { id: "saved", folderId: "folder", name: "Saved signer", publicKey: signer.publicKey(), secretKey: "", hasKey: true, browserSigningEnabled: false, position: 0 };
const watchWallet = { ...savedWallet, id: "watch", name: "Watch wallet", publicKey: destination, hasKey: false };

async function setup(page: Page, walletId = "saved") {
  await page.addInitScript((id) => localStorage.setItem("active_wallet_id", id), walletId);
  await page.route("**/api/db/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/wallets-v2") ? [savedWallet, watchWallet]
      : path.endsWith("/wallet-folders") ? [{ id: "folder", name: "Test wallets", position: 0 }]
      : path.endsWith("/app-state") ? { active_wallet_id: walletId }
      : path.endsWith("/startup-sync") ? { ok: true, skipped: true } : [];
    await route.fulfill({ json: body });
  });
  await page.route("https://horizon.stellar.org/**", async (route) => {
    const address = new URL(route.request().url()).pathname.split("/").at(-1)!;
    await route.fulfill({ json: {
      id: address, account_id: address, sequence: "1", subentry_count: 0, data_attr: {},
      num_sponsoring: 0, num_sponsored: 0,
      balances: [{ asset_type: "native", balance: "100.0000000", selling_liabilities: "0", buying_liabilities: "0" }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      signers: [{ key: address, weight: 1 }],
    } });
  });
  const walletsLoaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/db/wallets-v2" && response.request().method() === "GET", { timeout: 15_000 });
  await page.goto("/payments");
  await walletsLoaded;
  await expect(page.locator("header").getByText(walletId === "watch" ? "Watch wallet" : "Saved signer")).toBeVisible();
}
async function confirmPayment(page: Page, saved = true) {
  if (saved) await expect(page.getByText("Payments uses your saved key", { exact: false })).toBeVisible();
  await page.getByPlaceholder("0.00", { exact: true }).first().fill("1");
  await page.getByPlaceholder("G...", { exact: true }).first().fill(destination);
  await page.getByRole("button", { name: "Skip memo", exact: true }).click();
  await page.getByRole("button", { name: "Sign & Submit", exact: true }).click();
  await page.getByRole("button", { name: "Confirm & Submit", exact: true }).click();
}

test("a connected wallet with a masked key signs and submits without manual key entry", async ({ page }) => {
  let submitted = false;
  await setup(page);
  await page.route("**/api/wallet/sign", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.walletId).toBe("saved");
    expect(body).not.toHaveProperty("secretKey");
    const tx = TransactionBuilder.fromXDR(body.xdr, Networks.PUBLIC); tx.sign(signer);
    await route.fulfill({ json: { xdr: tx.toXDR() } });
  });
  await page.route("**/api/transactions/submit", async (route) => {
    submitted = true;
    await route.fulfill({ json: { hash: "test-payment-hash", successful: true } });
  });
  await expect(page.locator("header").getByText("100.00 XLM")).toBeVisible();
  await expect(page.locator("#secret-key")).toHaveCount(0);
  await confirmPayment(page);
  await expect(page.getByText("test-payment-hash", { exact: false }).first()).toBeVisible();
  expect(submitted).toBe(true);
});

test("Trustline Manager signs with a connected wallet whose key is masked", async ({ page }) => {
  await setup(page);
  await page.route("**/api/wallet/sign", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.walletId).toBe("saved");
    const tx = TransactionBuilder.fromXDR(body.xdr, Networks.PUBLIC);
    expect(tx.operations[0].type).toBe("changeTrust");
    tx.sign(signer);
    await route.fulfill({ json: { xdr: tx.toXDR() } });
  });
  await page.route("**/api/transactions/submit", async (route) => {
    await route.fulfill({ json: { hash: "test-trustline-hash", successful: true } });
  });
  await page.goto("/trustline-manager");
  await expect(page.locator("#st-secret")).toHaveCount(0);
  await page.locator("#st-code").fill("wUSDC");
  await page.locator("#st-issuer").fill(destination);
  await page.getByRole("button", { name: "Add Trustline", exact: true }).last().click();
  await expect(page.getByText("Done — tx hash: test-trustline-hash", { exact: true })).toBeVisible();
});

test("a watch-only wallet cannot enable Payments signing", async ({ page }) => {
  await setup(page, "watch");
  await expect(page.getByText("Watch-only wallet:", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign & Submit", exact: true })).toBeDisabled();
});

test("changing the connected wallet during signing prevents submission even after switching back", async ({ page }) => {
  let release!: () => void;
  let submitted = false;
  await setup(page);
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/wallet/sign", async (route) => {
    const tx = TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC); tx.sign(signer);
    await pending;
    await route.fulfill({ json: { xdr: tx.toXDR() } });
  });
  await page.route("**/api/transactions/submit", async (route) => {
    submitted = true; await route.fulfill({ json: { hash: "must-not-submit" } });
  });
  await confirmPayment(page);
  await expect(page.getByRole("button", { name: "Signing...", exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("active_wallet_id", "watch");
    window.dispatchEvent(new StorageEvent("storage", { key: "active_wallet_id", newValue: "watch" }));
  });
  await expect(page.getByText("Watch-only wallet:", { exact: false })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("active_wallet_id", "saved");
    window.dispatchEvent(new StorageEvent("storage", { key: "active_wallet_id", newValue: "saved" }));
  });
  await expect(page.getByText("Payments uses your saved key", { exact: false })).toBeVisible();
  release();
  await expect(page.getByText("Signing wallet changed. Review the payment again.", { exact: true }).first()).toBeVisible();
  expect(submitted).toBe(false);
});

test("manual signing still retries a native payment as account creation", async ({ page }) => {
  let submissions = 0;
  let serverSigning = false;
  await setup(page);
  await expect(page.getByText("Payments uses your saved key", { exact: false })).toBeVisible();
  await page.getByTitle("Clear wallet", { exact: true }).click();
  await page.locator("#secret-key").fill(signer.secret());
  await page.route("**/api/wallet/sign", async (route) => {
    serverSigning = true; await route.abort();
  });
  await page.route("**/api/transactions/submit", async (route) => {
    submissions++;
    const xdr = route.request().postDataJSON().xdr;
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    expect(signer.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
    if (submissions === 1) {
      expect(tx.operations[0].type).toBe("payment");
      await route.fulfill({ status: 400, json: { extras: { result_codes: { transaction: "tx_failed", operations: ["op_no_destination"] } } } });
    } else {
      expect(tx.operations[0].type).toBe("createAccount");
      await route.fulfill({ json: { hash: "manual-retry-hash", successful: true } });
    }
  });
  await confirmPayment(page, false);
  await expect(page.getByText("manual-retry-hash", { exact: true })).toBeVisible();
  expect(submissions).toBe(2);
  expect(serverSigning).toBe(false);
  await expect(page.locator("#secret-key")).toHaveCount(0);
});

test("Payments keeps each tab's draft while switching between extracted tabs", async ({ page }) => {
  await setup(page);
  await expect(page.getByText("Payments uses your saved key", { exact: false })).toBeVisible();
  await page.getByPlaceholder("0.00", { exact: true }).first().fill("1");
  await page.getByPlaceholder("G...", { exact: true }).first().fill(destination);
  await page.getByRole("button", { name: "Skip memo", exact: true }).click();

  await page.getByRole("tab", { name: "Path", exact: true }).click();
  await page.getByPlaceholder("0.00", { exact: true }).nth(0).fill("5");
  await page.getByPlaceholder("0.00", { exact: true }).nth(1).fill("2");
  await page.getByPlaceholder("G...", { exact: true }).first().fill(destination);

  await page.getByRole("tab", { name: "Claimable", exact: true }).click();
  await page.getByPlaceholder("0.00", { exact: true }).fill("3");
  await page.getByPlaceholder("G... (claimant address)").fill(destination);

  await page.getByRole("tab", { name: "Fee Bump", exact: true }).click();
  await page.getByPlaceholder("Paste the signed transaction XDR here…").fill("draft-xdr");
  await page.getByRole("tab", { name: "Sponsorship", exact: true }).click();

  await page.getByRole("tab", { name: "Send", exact: true }).click();
  await expect(page.getByPlaceholder("0.00", { exact: true }).first()).toHaveValue("1");
  await expect(page.getByPlaceholder("G...", { exact: true }).first()).toHaveValue(destination);
  await expect(page.getByRole("button", { name: "Memo skipped", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Path", exact: true }).click();
  await expect(page.getByPlaceholder("0.00", { exact: true }).nth(0)).toHaveValue("5");
  await expect(page.getByPlaceholder("0.00", { exact: true }).nth(1)).toHaveValue("2");
  await expect(page.getByPlaceholder("G...", { exact: true }).first()).toHaveValue(destination);

  await page.getByRole("tab", { name: "Claimable", exact: true }).click();
  await expect(page.getByPlaceholder("0.00", { exact: true })).toHaveValue("3");
  await expect(page.getByPlaceholder("G... (claimant address)")).toHaveValue(destination);

  await page.getByRole("tab", { name: "Fee Bump", exact: true }).click();
  await expect(page.getByPlaceholder("Paste the signed transaction XDR here…")).toHaveValue("draft-xdr");
});
