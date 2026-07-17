// tests/lib/asset-creator/preflight.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  checkAccountExists,
  checkBalance,
  checkAssetExists,
  estimateFees,
} from "../../../lib/asset-creator/preflight";

// Minimal Horizon.Server mock
function makeServer(overrides: Record<string, unknown> = {}) {
  return {
    loadAccount: vi.fn(),
    feeStats: vi.fn(),
    assets: vi.fn(),
    ...overrides,
  } as unknown as import("stellar-sdk").Horizon.Server;
}

const noop = () => {};
const signal = new AbortController().signal;

describe("checkAccountExists", () => {
  it("returns pass when account loads successfully", async () => {
    const server = makeServer({
      loadAccount: vi.fn().mockResolvedValue({ id: "GABC" }),
    });
    const result = await checkAccountExists("GABC", server, noop, signal);
    expect(result.status).toBe("pass");
  });

  it("returns warning (non-blocking) when loadAccount throws 404 — account will be created by the fund-accounts step", async () => {
    const server = makeServer({
      loadAccount: vi.fn().mockRejectedValue({ response: { status: 404 } }),
    });
    const result = await checkAccountExists("GABC", server, noop, signal);
    expect(result.status).toBe("warning");
    expect(result.blocking).toBe(false);
  });

  it("returns fail (blocking) when loadAccount throws a non-404 error", async () => {
    const server = makeServer({
      loadAccount: vi.fn().mockRejectedValue({ response: { status: 500 } }),
    });
    const result = await checkAccountExists("GABC", server, noop, signal);
    expect(result.status).toBe("fail");
    expect(result.blocking).toBe(true);
  });

  it("logs the GET URL", async () => {
    const logs: string[] = [];
    const server = makeServer({
      loadAccount: vi.fn().mockResolvedValue({ id: "GABC" }),
    });
    await checkAccountExists("GABC", server, (msg) => logs.push(msg), signal);
    expect(logs.some((l) => l.includes("GABC"))).toBe(true);
  });
});

describe("checkBalance", () => {
  it("returns pass when balance >= minXlm", async () => {
    const server = makeServer({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [{ asset_type: "native", balance: "10.0000000" }],
      }),
    });
    const result = await checkBalance("GABC", 1.5, server, noop, signal);
    expect(result.status).toBe("pass");
  });

  it("returns fail with message when balance < minXlm", async () => {
    const server = makeServer({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [{ asset_type: "native", balance: "0.5000000" }],
      }),
    });
    const result = await checkBalance("GABC", 1.5, server, noop, signal);
    expect(result.status).toBe("fail");
    expect(result.message).toBeDefined();
    expect(result.message).toContain("1.5");
  });
});

describe("checkAssetExists", () => {
  it("returns warning when asset is already issued", async () => {
    const mockCall = vi.fn().mockResolvedValue({ records: [{ asset_code: "TOKEN" }] });
    const server = makeServer({
      assets: vi.fn().mockReturnValue({ forCode: vi.fn().mockReturnValue({ forIssuer: vi.fn().mockReturnValue({ call: mockCall }) }) }),
    });
    const result = await checkAssetExists("TOKEN", "GISSUER", server, noop, signal);
    expect(result.status).toBe("warning");
    expect(result.blocking).toBe(false);
  });

  it("returns pass when asset does not yet exist", async () => {
    const mockCall = vi.fn().mockResolvedValue({ records: [] });
    const server = makeServer({
      assets: vi.fn().mockReturnValue({ forCode: vi.fn().mockReturnValue({ forIssuer: vi.fn().mockReturnValue({ call: mockCall }) }) }),
    });
    const result = await checkAssetExists("TOKEN", "GISSUER", server, noop, signal);
    expect(result.status).toBe("pass");
  });
});

describe("estimateFees", () => {
  it("returns fee string based on p50 × 4 transactions", async () => {
    const server = makeServer({
      feeStats: vi.fn().mockResolvedValue({
        fee_charged: { p50: "100" },
      }),
    });
    // 4 txns × 100 stroops = 400 stroops = 0.0000400 XLM
    const feesXlm = await estimateFees(server);
    expect(parseFloat(feesXlm)).toBeCloseTo(0.00004, 8);
  });
});
