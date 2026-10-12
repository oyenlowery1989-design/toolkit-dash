import { afterEach, expect, it, vi } from "vitest";
import { Account, Keypair, Networks, Operation, Transaction, TransactionBuilder } from "stellar-sdk";
import { signFunderTransaction } from "@/lib/account-funder/signing";
const parent = Keypair.random(); const child = Keypair.random();
function tx() { return new TransactionBuilder(new Account(parent.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC }).addOperation(Operation.createAccount({ destination: child.publicKey(), startingBalance: "3" })).setTimeout(60).build(); }
afterEach(() => vi.unstubAllGlobals());
it("signs manual/generated parents locally", async () => {
  const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
  const signed = await signFunderTransaction(tx(), null, parent, "direct", Networks.PUBLIC, new AbortController().signal);
  expect(parent.verify(signed.hash(), signed.signatures[0].signature())).toBe(true); expect(fetchSpy).not.toHaveBeenCalled();
});
it("sends only wallet identity and XDR for a saved parent", async () => {
  const fetchSpy = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); const signed = new Transaction(body.xdr, Networks.PUBLIC); signed.sign(parent);
    return new Response(JSON.stringify({ xdr: signed.toXDR() }), { status: 200 });
  }); vi.stubGlobal("fetch", fetchSpy);
  const signed = await signFunderTransaction(tx(), "saved", null, "direct", Networks.PUBLIC, new AbortController().signal);
  expect(parent.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
  expect(fetchSpy.mock.calls[0][1].body).not.toContain(parent.secret()); expect(JSON.parse(fetchSpy.mock.calls[0][1].body).walletId).toBe("saved");
});
it("reports policy failures and respects cancellation", async () => {
  const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Disabled" }), { status: 403 })); vi.stubGlobal("fetch", fetchSpy);
  await expect(signFunderTransaction(tx(), "saved", null, "direct", Networks.PUBLIC, new AbortController().signal)).rejects.toThrow("Disabled");
  const controller = new AbortController(); controller.abort();
  await expect(signFunderTransaction(tx(), "saved", null, "direct", Networks.PUBLIC, controller.signal)).rejects.toThrow("Aborted");
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
