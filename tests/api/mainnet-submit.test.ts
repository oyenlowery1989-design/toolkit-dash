import { Account, Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "stellar-sdk";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), reserve: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/mainnet-signing-budget", () => ({
  reserveMainnetSignature: mocks.reserve,
  MainnetSigningBudgetUnavailableError: class MainnetSigningBudgetUnavailableError extends Error {},
}));
import { POST } from "@/app/api/transactions/submit/route";

const sender = Keypair.random();
const recipient = Keypair.random().publicKey();
function signedPayment(amount = "1") {
  const tx = new TransactionBuilder(new Account(sender.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination: recipient, asset: Asset.native(), amount }))
    .setTimeout(30).build();
  tx.sign(sender);
  return tx;
}
function request(xdr: string) {
  return new NextRequest("http://localhost/api/transactions/submit", {
    method: "POST", body: JSON.stringify({ xdr }),
  });
}

beforeEach(() => {
  mocks.auth.mockResolvedValue({ ok: true, userId: "owner" });
  mocks.reserve.mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("authenticated mainnet submission", () => {
  it("reserves the signed payment before forwarding it to Horizon", async () => {
    const tx = signedPayment("2");
    const submit = vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValue({ hash: "submitted" } as never);
    const response = await POST(request(tx.toXDR()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hash: "submitted" });
    expect(mocks.reserve).toHaveBeenCalledWith("owner", tx.hash().toString("hex"), Number(tx.timeBounds?.maxTime),
      { destinations: [recipient], operationCount: 1, xlmAmount: 2.00001 });
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[0]);
  });

  it("refuses a payment rejected by the shared daily budget", async () => {
    mocks.reserve.mockResolvedValue(["Daily XLM limit would be exceeded"]);
    const submit = vi.spyOn(Horizon.Server.prototype, "submitTransaction");
    const response = await POST(request(signedPayment().toXDR()));
    expect(response.status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });

  it("returns Horizon result codes in the shape expected by existing payment modules", async () => {
    const submit = vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockRejectedValue({
      response: { status: 400, data: { title: "Transaction Failed", extras: { result_codes: { transaction: "tx_failed", operations: ["op_no_destination"] } } } },
    });
    const response = await POST(request(signedPayment().toXDR()));
    expect(response.status).toBe(400);
    expect((await response.json()).extras.result_codes.operations).toEqual(["op_no_destination"]);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("rejects unsigned XDR before reserving", async () => {
    const tx = signedPayment();
    tx.signatures.pop();
    expect((await POST(request(tx.toXDR()))).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});
