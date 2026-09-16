import { describe, expect, it } from "vitest";
import { classifyAdPayment } from "@/lib/saved-analyses/ad-payments";
import type { AssetProceedsResult, ProceedsLedgerEntry } from "@/lib/proceeds-investigator/types";

const RECIPIENT = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";

function entry(overrides: Partial<ProceedsLedgerEntry> = {}): ProceedsLedgerEntry {
  return {
    id: "1", account: "GSOURCE", category: "payment", amountXlm: 25, txHash: "tx", createdAt: "2026-01-01", to: RECIPIENT, successful: true,
    ...overrides,
  };
}

function result(overrides: Partial<AssetProceedsResult> = {}): AssetProceedsResult {
  return {
    assetCode: "FOO", issuer: "GISSUER", accounts: [], totalAssetSold: 1, totalXlmProceeds: 100,
    totalOutgoingXlm: 25, estimatedOnHandXlm: 75, dexTradeCount: 1, pathSaleCount: 0,
    proceedsLedger: [], outgoingLedger: [], topDestinations: [], ...overrides,
  };
}

describe("classifyAdPayment", () => {
  it("counts successful recipient payments by distinct ledger id, excluding fees and sales", () => {
    const payment = entry();
    const classification = classifyAdPayment(result({ outgoingLedger: [
      payment, entry({ id: "2", txHash: payment.txHash }), entry({ id: "3", category: "fee", amountXlm: 100 }),
      entry({ id: "4", category: "path_sale", amountXlm: 100 }), entry({ id: "5", successful: false, amountXlm: 100 }),
      entry({ ...payment }),
    ] }), ` ${RECIPIENT} `);
    expect(classification).toMatchObject({ status: "compliant", paidXlm: 50, percentage: 50, requiredXlm: 25, shortfallXlm: 0 });
    expect(classification.evidence.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("labels positive-proceeds payments below the quarter boundary underpaid", () => {
    const classification = classifyAdPayment(result({ outgoingLedger: [entry({ amountXlm: 24.999999 })] }), RECIPIENT);
    expect(classification).toMatchObject({ status: "underpaid", paidXlm: 24.999999, percentage: 24.999999, requiredXlm: 25 });
    expect(classification.shortfallXlm).toBeCloseTo(0.000001, 12);
  });

  it("handles exact and floating quarter boundaries without accepting a one-stroop shortfall", () => {
    expect(classifyAdPayment(result({ outgoingLedger: [entry()] }), RECIPIENT).status).toBe("compliant");
    expect(classifyAdPayment(result({ outgoingLedger: [entry({ amountXlm: 25 - 0.0000001 })] }), RECIPIENT)).toMatchObject({
      status: "underpaid", shortfallXlm: expect.closeTo(0.0000001, 12),
    });
    expect(classifyAdPayment(result({ totalXlmProceeds: 1.2, outgoingLedger: [entry({ id: "a", amountXlm: 0.1 }), entry({ id: "b", amountXlm: 0.2 })] }), RECIPIENT).status).toBe("compliant");
    expect(classifyAdPayment(result({ totalXlmProceeds: 1_000_000_000, outgoingLedger: [entry({ amountXlm: 249_999_999.9999999 })] }), RECIPIENT).status).toBe("underpaid");
  });

  it("labels no successful payment unpaid and handles zero proceeds", () => {
    expect(classifyAdPayment(result(), RECIPIENT)).toMatchObject({ status: "unpaid", paidXlm: 0, percentage: 0, requiredXlm: 25, shortfallXlm: 25 });
    expect(classifyAdPayment(result({ totalXlmProceeds: 0, outgoingLedger: [entry({ amountXlm: 1 })] }), RECIPIENT)).toMatchObject({
      status: "compliant", paidXlm: 1, percentage: null, requiredXlm: 0, shortfallXlm: 0,
    });
    expect(classifyAdPayment(result({ totalXlmProceeds: 0 }), RECIPIENT)).toMatchObject({ status: "unpaid", paidXlm: 0, percentage: 0 });
  });

  it("returns unknown for missing configuration, malformed results, and malformed matching rows", () => {
    expect(classifyAdPayment(result(), "")).toMatchObject({ status: "unknown", reason: "Configure a valid recipient address." });
    expect(classifyAdPayment(null, RECIPIENT)).toMatchObject({ status: "unknown" });
    expect(classifyAdPayment(result({ totalXlmProceeds: Number.NaN }), RECIPIENT)).toMatchObject({ status: "unknown" });
    expect(classifyAdPayment({ ...result(), outgoingLedger: undefined } as unknown as AssetProceedsResult, RECIPIENT)).toMatchObject({ status: "unknown" });
    expect(classifyAdPayment(result({ outgoingLedger: [{ ...entry(), amountXlm: Number.NaN }] }), RECIPIENT)).toMatchObject({ status: "unknown" });
    expect(classifyAdPayment(result({ outgoingLedger: [null] as unknown as ProceedsLedgerEntry[] }), RECIPIENT)).toMatchObject({ status: "unknown" });
    expect(classifyAdPayment(result({ outgoingLedger: [{}] as unknown as ProceedsLedgerEntry[] }), RECIPIENT)).toMatchObject({ status: "unknown" });
    expect(classifyAdPayment(result({ outgoingLedger: [{ ...entry(), txHash: 1 } as unknown as ProceedsLedgerEntry] }), RECIPIENT)).toMatchObject({ status: "unknown" });
    expect(classifyAdPayment(result({ outgoingLedger: [{ ...entry(), from: { invalid: true } } as unknown as ProceedsLedgerEntry] }), RECIPIENT)).toMatchObject({ status: "unknown" });
  });

  it("uses only the outgoing ledger, not destination summaries or other recipients", () => {
    expect(classifyAdPayment(result({ topDestinations: [{ address: RECIPIENT, totalXlm: 100, count: 1 }] }), RECIPIENT).status).toBe("unpaid");
    expect(classifyAdPayment(result({ outgoingLedger: [entry({ to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" })] }), RECIPIENT).status).toBe("unpaid");
  });
});
