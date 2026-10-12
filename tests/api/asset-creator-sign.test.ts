import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Keypair, Networks, Operation, Transaction, TransactionBuilder } from "stellar-sdk";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), signer: vi.fn(), reserve: vi.fn(), claim: vi.fn(), readClaim: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/saved-wallet-server", () => ({ loadSavedWalletSigner: mocks.signer }));
vi.mock("@/lib/mainnet-signing-budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mainnet-signing-budget")>()),
  reserveMainnetSignature: mocks.reserve,
}));
vi.mock("@/lib/asset-creator/issuance-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/asset-creator/issuance-guard")>()),
  claimAssetIssuance: mocks.claim,
  readAssetIssuanceClaim: mocks.readClaim,
}));
import { POST } from "@/app/api/asset-creator/sign/route";
const signer = Keypair.random();
const destination = Keypair.random().publicKey();
function request(stepId: string, operations: Parameters<TransactionBuilder["addOperation"]>[0][], source = signer.publicKey(), timeout = 180, sequence = "1", network: "public" | "testnet" = "public") {
  const builder = new TransactionBuilder(new Account(source, sequence), { fee: "100", networkPassphrase: network === "public" ? Networks.PUBLIC : Networks.TESTNET });
  for (const op of operations) builder.addOperation(op);
  return new NextRequest("http://localhost/api/asset-creator/sign", { method: "POST", body: JSON.stringify({ walletId: "saved", stepId, network, xdr: builder.setTimeout(timeout).build().toXDR() }) });
}
const issuance = () => Operation.payment({ destination, asset: new Asset("myTOKEN", signer.publicKey()), amount: "100" });
beforeEach(() => {
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true");
  vi.stubEnv("MAINNET_EMERGENCY_STOP", "false");
  vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", "");
  mocks.auth.mockResolvedValue({ ok: true, userId: "owner" });
  mocks.signer.mockResolvedValue(signer);
  mocks.reserve.mockResolvedValue([]);
  mocks.claim.mockImplementation(async (claim: { signed_xdr: string }) => claim.signed_xdr);
  mocks.readClaim.mockResolvedValue(null);
  mocks.claim.mockClear();
  mocks.readClaim.mockClear();
  mocks.reserve.mockClear();
});
afterEach(() => vi.unstubAllEnvs());
describe("Asset Creator saved-wallet signing", () => {
  it("signs all four creation steps without returning secrets", async () => {
    const cases = [
      ["fund-accounts", [Operation.createAccount({ destination, startingBalance: "2.1" }), Operation.createAccount({ destination: Keypair.random().publicKey(), startingBalance: "2" })]],
      ["set-home-domain", [Operation.setOptions({ homeDomain: "example.com" })]],
      ["trustline", [Operation.changeTrust({ asset: new Asset("myTOKEN", destination) })]],
      ["issuance", [issuance()]],
    ] as const;
    for (const [stepId, ops] of cases) {
      const response = await POST(request(stepId, [...ops]));
      expect(response.status).toBe(200);
      const body = await response.json();
      const signed = new Transaction(body.xdr, Networks.PUBLIC);
      expect(signer.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
      expect(JSON.stringify(body)).not.toContain(signer.secret());
    }
    expect(mocks.signer).toHaveBeenCalledWith("saved", "owner");
  });
  it("requires authentication and wallet ownership", async () => {
    mocks.auth.mockResolvedValueOnce({ ok: false, response: new Response("", { status: 401 }) });
    expect((await POST(request("issuance", [issuance()]))).status).toBe(401);
    mocks.signer.mockResolvedValueOnce(null);
    expect((await POST(request("issuance", [issuance()]))).status).toBe(404);
    mocks.signer.mockRejectedValueOnce(new Error("This wallet is watch-only; no signing key is saved"));
    expect((await POST(request("issuance", [issuance()]))).status).toBe(400);
  });
  it("rejects unrelated spending, authority changes and foreign sources", async () => {
    const cases = [
      request("issuance", [Operation.payment({ destination, asset: Asset.native(), amount: "1" })]),
      request("issuance", [Operation.payment({ destination, asset: new Asset("other", destination), amount: "1" })]),
      request("set-home-domain", [Operation.setOptions({ homeDomain: "example.com", masterWeight: 0 })]),
      request("fund-accounts", [Operation.createAccount({ destination, startingBalance: "10" })]),
      request("trustline", [Operation.changeTrust({ asset: new Asset("myTOKEN", destination), limit: "0" })]),
      request("issuance", [issuance()], destination),
      request("issuance", [Operation.payment({ destination, source: destination, asset: new Asset("myTOKEN", signer.publicKey()), amount: "1" })]),
      request("issuance", [issuance(), issuance()]),
      request("unknown", [issuance()]),
      request("issuance", [issuance()], signer.publicKey(), 0),
    ];
    for (const req of cases) expect((await POST(req)).status).toBe(400);
  });
  it("enforces mainnet enablement, emergency stop and allowlist", async () => {
    mocks.reserve.mockResolvedValueOnce(["Mainnet transactions disabled"]);
    expect((await POST(request("issuance", [issuance()]))).status).toBe(403);
    mocks.reserve.mockResolvedValueOnce(["Emergency stop active"]);
    expect((await POST(request("issuance", [issuance()]))).status).toBe(403);
    mocks.reserve.mockResolvedValueOnce(["Destination not allowed"]);
    expect((await POST(request("issuance", [issuance()]))).status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("claims only issuance, keyed by the exact asset code", async () => {
    await POST(request("trustline", [Operation.changeTrust({ asset: new Asset("myTOKEN", destination) })]));
    expect(mocks.claim).not.toHaveBeenCalled();
    expect((await POST(request("issuance", [issuance()]))).status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ network: "public", issuer: signer.publicKey(), asset_code: "myTOKEN" }));
    expect(mocks.reserve).toHaveBeenCalledWith("owner", expect.any(String), expect.any(Number), expect.objectContaining({ operationCount: 1 }));
  });
  it("signs testnet issuance for testnet and skips the mainnet budget", async () => {
    const response = await POST(request("issuance", [issuance()], signer.publicKey(), 180, "1", "testnet"));
    expect(response.status).toBe(200);
    const signed = new Transaction((await response.json()).xdr, Networks.TESTNET);
    expect(signer.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
    expect(signer.verify(new Transaction(signed.toXDR(), Networks.PUBLIC).hash(), signed.signatures[0].signature())).toBe(false);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ network: "testnet", asset_code: "myTOKEN" }));
  });
  it("replays only the original signed issuance when retry builds a new XDR", async () => {
    const original = request("issuance", [issuance()]);
    const first = await POST(original);
    expect(first.status).toBe(200);
    const signedXdr = (await first.json()).xdr;
    mocks.readClaim.mockResolvedValue(signedXdr);
    mocks.claim.mockClear();
    mocks.reserve.mockClear();
    const replay = await POST(request("issuance", [issuance()], signer.publicKey(), 180, "2"));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ xdr: signedXdr });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).toHaveBeenCalledWith("owner", new Transaction(signedXdr, Networks.PUBLIC).hash().toString("hex"), expect.any(Number), expect.any(Object));
  });
  it("returns the stored signature when another request wins the claim race", async () => {
    const originalRequest = request("issuance", [issuance()]);
    const original = TransactionBuilder.fromXDR((await originalRequest.json()).xdr, Networks.PUBLIC);
    if (!(original instanceof Transaction)) throw new Error("Expected a regular transaction");
    original.sign(signer);
    mocks.claim.mockResolvedValueOnce(original.toXDR());
    const response = await POST(request("issuance", [issuance()], signer.publicKey(), 180, "2"));
    expect(response.status).toBe(200);
    expect((await response.json()).xdr).toBe(original.toXDR());
    expect(mocks.reserve).toHaveBeenCalledWith("owner", original.hash().toString("hex"), expect.any(Number), expect.any(Object));
  });
  it("requires manual reconciliation after the original issuance expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const first = await POST(request("issuance", [issuance()]));
      expect(first.status).toBe(200);
      mocks.readClaim.mockResolvedValue((await first.json()).xdr);
      mocks.claim.mockClear();
      vi.setSystemTime(Date.now() + 181_000);
      const response = await POST(request("issuance", [issuance()], signer.publicKey(), 180, "2"));
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/expired.*reconcile.*manually/i);
      expect(mocks.claim).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("does not return a signature when issuance protection is unavailable", async () => {
    const { IssuanceProtectionUnavailableError } = await import("@/lib/asset-creator/issuance-guard");
    mocks.claim.mockRejectedValueOnce(new IssuanceProtectionUnavailableError());
    expect((await POST(request("issuance", [issuance()]))).status).toBe(503);
  });
});
