import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Horizon, Keypair, Networks, Operation, Transaction, TransactionBuilder } from "stellar-sdk";
import { NextRequest } from "next/server";
import { validateMainnetRun } from "@/lib/mainnet-safety";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), signer: vi.fn(), reserve: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/saved-wallet-server", () => ({ loadSavedWalletSigner: mocks.signer }));
vi.mock("@/lib/mainnet-signing-budget", () => ({
  reserveMainnetSignature: mocks.reserve,
  MainnetSigningBudgetUnavailableError: class MainnetSigningBudgetUnavailableError extends Error {},
}));
import { POST } from "@/app/api/account-funder/sign/route";
const parent = Keypair.random(); const child = Keypair.random(); const destination = Keypair.random().publicKey();
function build(ops: Parameters<TransactionBuilder["addOperation"]>[0][], source = parent.publicKey()) {
  const builder = new TransactionBuilder(new Account(source, "1"), { fee: "100", networkPassphrase: Networks.PUBLIC });
  for (const op of ops) builder.addOperation(op);
  return builder.setTimeout(60).build();
}
function request(purpose: string, tx: { toXDR(): string }) {
  return new NextRequest("http://localhost/api/account-funder/sign", { method: "POST", body: JSON.stringify({ walletId: "parent", purpose, xdr: tx.toXDR() }) });
}
function sponsored(sign = true, endSource = child.publicKey()) {
  const tx = build([
    Operation.beginSponsoringFutureReserves({ sponsoredId: child.publicKey(), source: parent.publicKey() }),
    Operation.createAccount({ destination: child.publicKey(), startingBalance: "0.0000001" }),
    Operation.endSponsoringFutureReserves({ source: endSource }),
  ]);
  if (sign) tx.sign(child);
  return tx;
}
function close(sign = true, ops = [Operation.accountMerge({ destination })]) {
  const inner = build(ops, child.publicKey());
  if (sign) inner.sign(child);
  return TransactionBuilder.buildFeeBumpTransaction(parent.publicKey(), "200", inner, Networks.PUBLIC);
}
beforeEach(() => {
  mocks.reserve.mockClear();
  mocks.reserve.mockImplementation(async (_userId, _hash, _expiry, intent) => validateMainnetRun(intent));
  mocks.auth.mockResolvedValue({ ok: true, userId: "owner" }); mocks.signer.mockResolvedValue(parent);
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true"); vi.stubEnv("MAINNET_EMERGENCY_STOP", "false"); vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("Account Funder purpose signing", () => {
  it("signs direct account creation with the owned parent", async () => {
    const response = await POST(request("direct", build([Operation.createAccount({ destination: child.publicKey(), startingBalance: "3" })])));
    expect(response.status).toBe(200); expect(mocks.signer).toHaveBeenCalledWith("parent", "owner");
    const body = await response.json(); const signed = new Transaction(body.xdr, Networks.PUBLIC);
    expect(parent.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
    expect(JSON.stringify(body)).not.toContain(parent.secret());
  });
  it("preserves child signatures while adding the parent sponsorship signature", async () => {
    const response = await POST(request("sponsored", sponsored())); expect(response.status).toBe(200);
    const tx = new Transaction((await response.json()).xdr, Networks.PUBLIC);
    expect(tx.signatures).toHaveLength(2);
    expect(tx.signatures.some((s) => child.verify(tx.hash(), s.signature()))).toBe(true);
    expect(tx.signatures.some((s) => parent.verify(tx.hash(), s.signature()))).toBe(true);
  });
  it("rejects incomplete, foreign-source or unsigned sponsorships", async () => {
    for (const tx of [sponsored(false), sponsored(true, destination), build([Operation.beginSponsoringFutureReserves({ sponsoredId: child.publicKey() })])]) {
      expect((await POST(request("sponsored", tx))).status).toBe(400);
    }
    expect((await POST(request("direct", build([Operation.createAccount({ source: child.publicKey(), destination, startingBalance: "3" })])))).status).toBe(400);
  });
  it("signs a child merge fee bump and checks the live merge balance", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValue({ balances: [{ asset_type: "native", balance: "5" }] } as never);
    const response = await POST(request("close", close())); expect(response.status).toBe(200);
    const signed = TransactionBuilder.fromXDR((await response.json()).xdr, Networks.PUBLIC);
    expect(parent.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
    vi.stubEnv("MAINNET_MAX_XLM_PER_RUN", "4"); expect((await POST(request("close", close()))).status).toBe(403);
  });
  it("rejects fee bumps of unrelated operations and unsigned merges", async () => {
    expect((await POST(request("close", close(false)))).status).toBe(400);
    const payment = Operation.payment({ destination, asset: Asset.native(), amount: "1" });
    expect((await POST(request("close", close(true, [payment] as never)))).status).toBe(400);
    expect((await POST(request("direct", build([payment])))).status).toBe(400);
  });
  it("fails closed when Horizon cannot verify the closing balance", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockRejectedValue(new Error("offline"));
    expect((await POST(request("close", close()))).status).toBe(503);
  });
  it("requires authentication and an owned signing wallet", async () => {
    const req = () => request("sponsored", sponsored());
    mocks.auth.mockResolvedValueOnce({ ok: false, response: new Response("", { status: 401 }) }); expect((await POST(req())).status).toBe(401);
    mocks.signer.mockResolvedValueOnce(null); expect((await POST(req())).status).toBe(404);
    mocks.signer.mockRejectedValueOnce(new Error("This wallet is watch-only")); expect((await POST(req())).status).toBe(400);
  });
  it("enforces emergency stop, allowlist, funding amount and locked reserve limits", async () => {
    vi.stubEnv("MAINNET_EMERGENCY_STOP", "true"); expect((await POST(request("sponsored", sponsored()))).status).toBe(403);
    vi.stubEnv("MAINNET_EMERGENCY_STOP", "false"); vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", parent.publicKey()); expect((await POST(request("sponsored", sponsored()))).status).toBe(403);
    vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", ""); vi.stubEnv("MAINNET_MAX_XLM_PER_RUN", "0.5"); expect((await POST(request("sponsored", sponsored()))).status).toBe(403);
    expect((await POST(request("direct", build([Operation.createAccount({ destination, startingBalance: "2" })])))).status).toBe(403);
  });
});
