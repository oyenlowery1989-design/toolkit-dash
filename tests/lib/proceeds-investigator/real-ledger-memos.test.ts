import { afterEach, expect, it, vi } from "vitest";
import { Networks, TransactionBuilder } from "stellar-sdk";
import gbvi from "../../fixtures/proceeds/gbvi-exchange-memos.json";
import aflwa from "../../fixtures/proceeds/aflwa-credit-memos.json";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import { mergeBeneficiaryGroups } from "@/lib/proceeds-investigator/beneficiaries";
afterEach(() => vi.unstubAllGlobals());
it.each([{ name: "GBVI", fixture: gbvi }, { name: "AFLWA seller", fixture: aflwa }])("reproduces the real $name memo group from transaction XDR without duplicate snapshot sums", async ({ fixture }) => {
  for (const raw of fixture.transactions) {
    const envelope = TransactionBuilder.fromXDR(raw.envelope_xdr, Networks.PUBLIC);
    expect(envelope.hash().toString("hex")).toBe(raw.hash);
    const tx = "innerTransaction" in envelope ? envelope.innerTransaction : envelope;
    expect(tx.memo.type).toBe("text");
    const value = Buffer.isBuffer(tx.memo.value) ? tx.memo.value.toString("utf8") : tx.memo.value;
    expect(value).toBe(raw.memo);
  }
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/") return Response.json({ history_elder_ledger: 1 });
    if (url.pathname.endsWith("/payments")) return Response.json({ _embedded: { records: fixture.payments } });
    if (url.pathname === "/trades") return Response.json({ _embedded: { records: [] } });
    if (url.pathname.startsWith("/transactions/")) return Response.json(fixture.transactions.find(tx => tx.hash === url.pathname.split("/").at(-1)));
    return Response.json({ balances: [{ asset_type: "native", balance: "0" }] });
  });
  const result = await fetchAssetXlmProceeds("https://horizon.example", "TOKEN", "issuer", [fixture.account], new AbortController().signal, undefined, undefined, undefined, { network: "public" });
  expect(result.beneficiaryGrouping?.unresolvedOperationCount).toBe(0);
  const groups = result.beneficiaryGrouping!.groups;
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ network: "public", address: fixture.payments[0].to, memoType: "text", memoValue: fixture.transactions[0].memo, senders: [fixture.account] });
  expect(groups[0].transfers).toHaveLength(fixture.payments.length);
  const expectedXlm = fixture.payments.reduce((total, op) => total + Number(op.amount), 0);
  expect(groups[0].totalXlm).toBeCloseTo(expectedXlm, 7);
  expect(mergeBeneficiaryGroups([...groups, ...groups, ...groups])[0].totalXlm).toBeCloseTo(expectedXlm, 7);
  expect(result.totalXlmProceeds).toBe(0); // Transfers alone are not asset sales.
});
