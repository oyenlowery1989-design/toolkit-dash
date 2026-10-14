import { expect, test, type Page, type Route } from "@playwright/test";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "stellar-sdk";

test.skip(!process.env.PAYMENT_SESSION_E2E, "Run with tests/e2e/playwright.session.config.ts to enable the real Auth SDK.");

const signer = Keypair.random();
const destinationSigner = Keypair.random();
const destination = destinationSigner.publicKey();
const storageKey = "sb-127-auth-token";
function session(id: string) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: id, exp: expires })).toString("base64url")}.test-signature`;
  return { access_token: token, refresh_token: `refresh-${id}`, token_type: "bearer", expires_in: 3600, expires_at: expires,
    user: { id, aud: "authenticated", role: "authenticated", email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
}
const userA = session("user-a");
const userB = session("user-b");
const refreshedA = { ...userA, access_token: `${userA.access_token}-rotated` };
const wallet = { id: "saved", folderId: "folder", name: "A saved signer", publicKey: signer.publicKey(), secretKey: "", hasKey: true, browserSigningEnabled: false, position: 0 };
const destinationWallet = { ...wallet, id: "destination", publicKey: destination, name: "A private destination wallet" };
const issuer = Keypair.random().publicKey();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function changeSession(page: Page, next: typeof userA) {
  const checked = page.waitForResponse((response) => response.url().endsWith("/api/payments/submission") && response.request().headers().authorization === `Bearer ${next.access_token}`);
  // This is the same storage + SDK BroadcastChannel notification used by another login tab.
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: "SIGNED_IN", session: value });
    channel.close();
  }, { key: storageKey, value: next });
  await checked;
  await expect(page.locator("header").getByText(next.user.email, { exact: true })).toBeVisible();
}

async function setup(page: Page, customAsset = false) {
  await page.context().addCookies([{ name: "sb-logged-in", value: "1", url: "http://127.0.0.1:3101" }]);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem("active_wallet_id", "saved");
  }, { key: storageKey, value: userA });
  // Fail closed for every external provider call, including any unexpected Auth refresh.
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:3101") await route.continue();
    else await route.abort("blockedbyclient");
  });
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => route.fulfill({ json: { user: userA.user } }));
  await page.route("**/api/db/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const isA = [userA.access_token, refreshedA.access_token].some((token) => route.request().headers().authorization === `Bearer ${token}`);
    const body = path.endsWith("/wallets-v2") ? (isA ? (customAsset ? [wallet, destinationWallet] : [wallet]) : [])
      : path.endsWith("/wallet-folders") ? [{ id: "folder", name: "Test wallets", position: 0 }]
      : path.endsWith("/app-state") ? { active_wallet_id: isA ? "saved" : null }
      : path.endsWith("/startup-sync") ? { ok: true, skipped: true } : [];
    return route.fulfill({ json: body });
  });
  await page.route("**/api/payments/submission", (route) => route.fulfill({ json: null }));
  await page.route("https://horizon.stellar.org/**", (route) => {
    const address = new URL(route.request().url()).pathname.split("/").at(-1)!;
    return route.fulfill({ json: { id: address, account_id: address, sequence: "1", subentry_count: 0, data_attr: {}, num_sponsoring: 0, num_sponsored: 0,
      balances: [{ asset_type: "native", balance: "100.0000000", selling_liabilities: "0", buying_liabilities: "0" },
        ...(customAsset ? [{ asset_type: "credit_alphanum12", asset_code: "wUSDC", asset_issuer: issuer, balance: "100.0000000", selling_liabilities: "0", buying_liabilities: "0" }] : [])],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }, signers: [{ key: address, weight: 1 }] } });
  });
  await page.goto("/payments");
  await expect(page.locator("header").getByText(userA.user.email, { exact: true })).toBeVisible();
  await expect(page.getByText("Payments uses your saved key", { exact: false })).toBeVisible();
  await expect(page.getByText("Checking previous payment", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("tabpanel", { name: "Send", exact: true }).getByRole("combobox")).toBeVisible();
}

async function confirmPayment(page: Page) {
  await page.getByPlaceholder("0.00", { exact: true }).first().fill("1");
  await page.getByPlaceholder("G...", { exact: true }).first().fill(destination);
  await page.getByRole("button", { name: "Skip memo", exact: true }).click();
  await page.getByRole("button", { name: "Sign & Submit", exact: true }).click();
  await page.getByRole("button", { name: "Confirm & Submit", exact: true }).click();
}

async function sign(route: Route) {
  expect(route.request().headers().authorization).toBe(`Bearer ${userA.access_token}`);
  const tx = TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC);
  tx.sign(signer);
  await route.fulfill({ json: { xdr: tx.toXDR() } });
}

async function assertCleanOutcome(page: Page) {
  await expect(page.getByText("Transaction Submitted", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A new payment is blocked", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Session changed. Review the payment again.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Signing...", exact: true })).toHaveCount(0);
}

test("the authenticated A fixture signs and submits when the session stays A", async ({ page }) => {
  await setup(page);
  let submissions = 0;
  await page.route("**/api/wallet/sign", sign);
  await page.route("**/api/transactions/submit", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${userA.access_token}`);
    const tx = TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC);
    expect(signer.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
    submissions++;
    await route.fulfill({ json: { hash: "a-control-success", successful: true } });
  });
  await confirmPayment(page);
  await expect(page.getByText("a-control-success", { exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test("restored auth loads wallets without a focus or storage workaround", async ({ page }) => {
  await setup(page);
  await expect(page.locator("header").getByText(wallet.name, { exact: true })).toBeVisible();
  await changeSession(page, userB);
  await expect(page.locator("header").getByText(wallet.name, { exact: true })).toHaveCount(0);
  await changeSession(page, userA);
  await expect(page.getByText("Payments uses your saved key", { exact: false })).toBeVisible();
});

test("changing auth user clears manual secrets and private payment drafts", async ({ page }) => {
  await setup(page);
  await page.getByPlaceholder("G...", { exact: true }).first().fill(destination);
  await page.getByPlaceholder("Memo text…").fill("A private memo");
  await page.getByRole("tab", { name: "Fee Bump", exact: true }).click();
  await page.getByPlaceholder("Paste the signed transaction XDR here…").fill("A private signed envelope");
  await page.getByTitle("Clear wallet", { exact: true }).click();
  await page.locator("#secret-key").fill(signer.secret());
  await page.evaluate(({ key, value }) => {
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: "TOKEN_REFRESHED", session: value });
    channel.close();
  }, { key: storageKey, value: refreshedA });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const refreshedRead = page.waitForResponse((response) => response.url().endsWith("/api/db/wallets-v2") && response.request().headers().authorization === `Bearer ${refreshedA.access_token}`);
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "wallets_v2_updated_at", newValue: String(Date.now()) })));
  await refreshedRead;
  await expect(page.locator("#secret-key")).toHaveValue(signer.secret());
  await expect(page.getByPlaceholder("Paste the signed transaction XDR here…")).toHaveValue("A private signed envelope");
  await changeSession(page, userB);
  await expect(page.locator("#secret-key")).toHaveValue("");
  await expect(page.getByPlaceholder("Paste the signed transaction XDR here…")).toHaveValue("");
  await page.getByRole("tab", { name: "Send", exact: true }).click();
  await expect(page.getByPlaceholder("Memo text…")).toHaveValue("");
  await expect(page.getByPlaceholder("G...", { exact: true }).first()).toHaveValue("");
});

for (const switchBack of [false, true]) {
  test(`pending A signature cannot submit after A → B${switchBack ? " → A" : ""}`, async ({ page }) => {
    await setup(page);
    const hold = deferred();
    const finished = deferred();
    let submissions = 0;
    await page.route("**/api/wallet/sign", async (route) => { await hold.promise; await sign(route); finished.resolve(); });
    await page.route("**/api/transactions/submit", async (route) => { submissions++; await route.fulfill({ json: { hash: "must-not-submit" } }); });
    await confirmPayment(page);
    await expect(page.getByRole("button", { name: "Signing...", exact: true })).toBeVisible();
    await changeSession(page, userB);
    await assertCleanOutcome(page);
    await expect(page.getByText("Payments uses your saved key", { exact: false })).toHaveCount(0);
    if (switchBack) await changeSession(page, userA);
    const response = page.waitForResponse("**/api/wallet/sign");
    hold.resolve();
    await finished.promise;
    await response;
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await assertCleanOutcome(page);
    expect(submissions).toBe(0);
  });
}

test("late A recovery cannot expose A journal in B", async ({ page }) => {
  await setup(page);
  const hold = deferred();
  const started = deferred();
  let delayed = false;
  await page.route("**/api/payments/submission", async (route) => {
    if (!delayed && route.request().headers().authorization === `Bearer ${userA.access_token}`) {
      delayed = true;
      started.resolve();
      await hold.promise;
      await route.fulfill({ json: { hash: "a-private-journal", xdr: "a-private-envelope", status: "pending" } });
    } else await route.fulfill({ json: null });
  });
  await page.getByPlaceholder("0.00", { exact: true }).first().fill("1");
  await page.getByPlaceholder("G...", { exact: true }).first().fill(destination);
  await page.getByRole("button", { name: "Skip memo", exact: true }).click();
  await page.getByRole("button", { name: "Sign & Submit", exact: true }).click();
  await page.getByRole("button", { name: "Confirm & Submit", exact: true }).click();
  await started.promise;
  await changeSession(page, userB);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/payments/submission") && r.request().headers().authorization === `Bearer ${userA.access_token}`);
  hold.resolve();
  await response;
  await assertCleanOutcome(page);
  await expect(page.getByText("a-private-journal", { exact: false })).toHaveCount(0);
});

test("late A submission outcome cannot appear in B", async ({ page }) => {
  await setup(page);
  const hold = deferred();
  const started = deferred();
  await page.route("**/api/wallet/sign", sign);
  await page.route("**/api/transactions/submit", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${userA.access_token}`);
    started.resolve();
    await hold.promise;
    await route.fulfill({ json: { hash: "a-private-success", successful: true } });
  });
  await confirmPayment(page);
  await started.promise;
  await changeSession(page, userB);
  const response = page.waitForResponse("**/api/transactions/submit");
  hold.resolve();
  await response;
  await assertCleanOutcome(page);
  await expect(page.getByText("a-private-success", { exact: false })).toHaveCount(0);
});

async function selectCustomAsset(page: Page, removeTrustline = false) {
  await page.getByRole("tabpanel", { name: "Send", exact: true }).getByRole("combobox").click();
  await page.getByRole("option", { name: "wUSDC", exact: false }).click();
  if (removeTrustline) await page.getByRole("switch").click();
}

async function settleResponse(page: Page, response: ReturnType<Page["waitForResponse"]>) {
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  // Sonner schedules toast insertion separately from the settled fetch/React update.
  await page.waitForTimeout(100);
}

for (const lookup of ["account", "offers", "next offer page"] as const) {
  test(`late A ${lookup} lookup cannot leave B signing`, async ({ page }) => {
    await setup(page, lookup !== "account");
    if (lookup !== "account") await selectCustomAsset(page, true);
    const hold = deferred();
    const started = deferred();
    let signatures = 0;
    let submissions = 0;
    await page.route("**/api/wallet/sign", async (route) => { signatures++; await sign(route); });
    await page.route("**/api/transactions/submit", async (route) => { submissions++; await route.fulfill({ json: { hash: "must-not-submit" } }); });
    const delayedUrl = lookup === "account" ? `https://horizon.stellar.org/accounts/${signer.publicKey()}` : "https://horizon.stellar.org/**/offers*";
    await page.route(delayedUrl, async (route) => {
      if (lookup === "next offer page" && !route.request().url().includes("cursor=next")) {
        await route.fulfill({ json: { _embedded: { records: Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1), price: "1", selling: { asset_type: "native" }, buying: { asset_type: "native" } })) }, _links: { next: { href: `https://horizon.stellar.org/accounts/${signer.publicKey()}/offers?cursor=next` } } } });
        return;
      }
      started.resolve();
      await hold.promise;
      if (lookup === "account") await route.fallback();
      else await route.fulfill({ json: { _embedded: { records: [] }, _links: {} } });
    });
    await confirmPayment(page);
    await started.promise;
    await changeSession(page, userB);
    const response = page.waitForResponse((r) => lookup === "account" ? r.url() === delayedUrl : r.url().includes("/offers") && (lookup !== "next offer page" || r.url().includes("cursor=next")));
    hold.resolve();
    await settleResponse(page, response);
    await assertCleanOutcome(page);
    expect(signatures).toBe(0);
    expect(submissions).toBe(0);
  });
}

test("late failed A payment cannot restore its private trustline prompt in B", async ({ page }) => {
  await setup(page, true);
  await selectCustomAsset(page);
  const hold = deferred();
  const started = deferred();
  let acknowledgements = 0;
  await page.route("**/api/payments/submission", async (route) => {
    if (route.request().method() === "DELETE") acknowledgements++;
    await route.fulfill({ json: null });
  });
  await page.route("**/api/wallet/sign", sign);
  await page.route("**/api/transactions/submit", async (route) => {
    started.resolve();
    await hold.promise;
    await route.fulfill({ status: 400, json: { extras: { result_codes: { transaction: "tx_failed", operations: ["op_no_trust"] } } } });
  });
  await confirmPayment(page);
  await started.promise;
  await changeSession(page, userB);
  const response = page.waitForResponse("**/api/transactions/submit");
  hold.resolve();
  await settleResponse(page, response);
  await assertCleanOutcome(page);
  await expect(page.getByText("Trustline Required", { exact: true })).toHaveCount(0);
  await expect(page.getByText(destinationWallet.name, { exact: false })).toHaveCount(0);
  expect(acknowledgements).toBe(0);
});

for (const failed of [false, true]) {
  test(`late A trustline retry ${failed ? "failure" : "success"} cannot change B`, async ({ page }) => {
    await setup(page, true);
    await selectCustomAsset(page);
    const hold = deferred();
    const started = deferred();
    let submissions = 0;
    await page.route("**/api/wallet/sign", async (route) => {
      expect(route.request().headers().authorization).toBe(`Bearer ${userA.access_token}`);
      const body = route.request().postDataJSON();
      expect([wallet.id, destinationWallet.id]).toContain(body.walletId);
      const tx = TransactionBuilder.fromXDR(body.xdr, Networks.PUBLIC);
      tx.sign(body.walletId === destinationWallet.id ? destinationSigner : signer);
      await route.fulfill({ json: { xdr: tx.toXDR() } });
    });
    await page.route("**/api/transactions/submit", async (route) => {
      submissions++;
      if (submissions === 1) {
        await route.fulfill({ status: 400, json: { extras: { result_codes: { transaction: "tx_failed", operations: ["op_no_trust"] } } } });
        return;
      }
      expect(TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC).operations[0].type).toBe("changeTrust");
      started.resolve();
      await hold.promise;
      await route.fulfill(failed ? { status: 400, json: { error: "A private trustline failure" } } : { json: { hash: "a-private-trustline-success" } });
    });
    await confirmPayment(page);
    await expect(page.getByText("Trustline Required", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add trustline & retry", exact: true }).click();
    await started.promise;
    await changeSession(page, userB);
    const response = page.waitForResponse("**/api/transactions/submit");
    hold.resolve();
    await settleResponse(page, response);
    await assertCleanOutcome(page);
    await expect(page.getByText(`Trustline added on ${destinationWallet.name}`, { exact: true })).toHaveCount(0);
    await expect(page.getByText("Failed to add trustline:", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm & Submit", exact: true })).toHaveCount(0);
    expect(submissions).toBe(2);
  });
}

test("pending A fee-bump signature cannot submit in B", async ({ page }) => {
  await setup(page);
  const inner = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: "1" })).setTimeout(30).build();
  inner.sign(signer);
  await page.getByRole("tab", { name: "Fee Bump", exact: true }).click();
  await page.getByPlaceholder("Paste the signed transaction XDR here…").fill(inner.toXDR());
  const hold = deferred();
  let submissions = 0;
  await page.route("**/api/wallet/sign", async (route) => { await hold.promise; await sign(route); });
  await page.route("**/api/transactions/submit", async (route) => { submissions++; await route.fulfill({ json: { hash: "must-not-submit" } }); });
  await page.getByRole("button", { name: "Bump Fee & Submit", exact: true }).click();
  await page.getByRole("button", { name: "Confirm & Submit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Signing...", exact: true })).toBeVisible();
  await changeSession(page, userB);
  const response = page.waitForResponse("**/api/wallet/sign");
  hold.resolve();
  await settleResponse(page, response);
  await assertCleanOutcome(page);
  expect(submissions).toBe(0);
});
