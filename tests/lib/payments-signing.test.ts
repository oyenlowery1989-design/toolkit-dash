import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "stellar-sdk";
import { setDbAuthToken } from "@/lib/db-client";
import { signPaymentTransaction } from "@/lib/payments-signing";
const key = Keypair.random();
function payment() {
  return new TransactionBuilder(new Account(key.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
    .setTimeout(30).build();
}
setDbAuthToken("session-token");
afterEach(() => vi.unstubAllGlobals());
describe("Payments signing", () => {
  it("uses the selected saved wallet without sending a secret", async () => {
    const tx = payment();
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.walletId).toBe("saved-wallet");
      expect(body).not.toHaveProperty("secretKey");
      const signed = TransactionBuilder.fromXDR(body.xdr, Networks.PUBLIC);
      signed.sign(key);
      return new Response(JSON.stringify({ xdr: signed.toXDR() }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const signed = await signPaymentTransaction(tx, "saved-wallet", "");
    expect(signed.signatures).toHaveLength(1);
    expect(key.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
  });
  it("keeps manual signing local", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const signed = await signPaymentTransaction(payment(), null, key.secret());
    expect(signed.signatures).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("surfaces server signing failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "No saved key" }), { status: 400 })));
    await expect(signPaymentTransaction(payment(), "saved-wallet", "")).rejects.toThrow("No saved key");
  });
  it("rejects a server response signing a different payment", async () => {
    const other = payment(); other.sign(key);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ xdr: other.toXDR() }))));
    await expect(signPaymentTransaction(payment(), "saved-wallet", "")).rejects.toThrow("changed");
  });
});
