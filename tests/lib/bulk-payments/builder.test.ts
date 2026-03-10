import { describe, it, expect } from "vitest";
import {
  estimateCost,
  MIN_PAYMENT_AMOUNT,
  BATCH_SIZE,
  BASE_FEE,
} from "../../../lib/bulk-payments/builder";

describe("constants", () => {
  it("MIN_PAYMENT_AMOUNT is 0.0000001", () => {
    expect(MIN_PAYMENT_AMOUNT).toBe("0.0000001");
  });

  it("BATCH_SIZE is 100", () => {
    expect(BATCH_SIZE).toBe(100);
  });

  it("BASE_FEE is 100", () => {
    expect(BASE_FEE).toBe("100");
  });
});

describe("estimateCost — batches", () => {
  it("200 recipients / 100 batch = 2 batches", () => {
    const { batches } = estimateCost(200, 100);
    expect(batches).toBe(2);
  });

  it("150 recipients / 100 batch = 2 batches (rounds up)", () => {
    const { batches } = estimateCost(150, 100);
    expect(batches).toBe(2);
  });

  it("1 recipient = 1 batch", () => {
    const { batches } = estimateCost(1, 100);
    expect(batches).toBe(1);
  });
});

describe("estimateCost — fees", () => {
  it("100 recipients × 100 stroops × 1 multiplier = 0.001 XLM", () => {
    const { feesXlm } = estimateCost(100, 100, 1, 0);
    expect(feesXlm).toBeCloseTo(0.001, 10);
  });

  it("fee multiplier 2x doubles feesXlm", () => {
    const { feesXlm: fee1x } = estimateCost(100, 100, 1, 0);
    const { feesXlm: fee2x } = estimateCost(100, 100, 2, 0);
    expect(fee2x).toBeCloseTo(fee1x * 2, 10);
  });
});

describe("estimateCost — payments", () => {
  const MIN_XLM = parseFloat(MIN_PAYMENT_AMOUNT);

  it("paymentsXlm = recipientCount × paymentXlmEach", () => {
    const { paymentsXlm } = estimateCost(100, 100, 1, MIN_XLM);
    expect(paymentsXlm).toBeCloseTo(100 * MIN_XLM, 10);
  });

  it("paymentXlmEach=0 → paymentsXlm=0", () => {
    const { paymentsXlm } = estimateCost(100, 100, 1, 0);
    expect(paymentsXlm).toBe(0);
  });

  it("paymentXlmEach=0 → totalXlm equals feesXlm", () => {
    const { feesXlm, paymentsXlm, totalXlm } = estimateCost(100, 100, 1, 0);
    expect(paymentsXlm).toBe(0);
    expect(totalXlm).toBeCloseTo(feesXlm, 10);
  });
});

describe("estimateCost — totalXlm", () => {
  it("totalXlm = feesXlm + paymentsXlm", () => {
    const MIN_XLM = parseFloat(MIN_PAYMENT_AMOUNT);
    const { feesXlm, paymentsXlm, totalXlm } = estimateCost(100, 100, 1, MIN_XLM);
    expect(totalXlm).toBeCloseTo(feesXlm + paymentsXlm, 10);
  });
});
