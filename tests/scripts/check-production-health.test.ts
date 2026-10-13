import { describe, expect, it, vi } from "vitest";
import { checkProductionHealth, evaluateHealth } from "../../scripts/check-production-health.mjs";

const healthy = {
  ok: true,
  provider: "supabase",
  encryption: { configured: true, plaintextSecrets: 0 },
  browserSigningEnabled: false,
  mainnet: {
    transactionsEnabled: true,
    emergencyStop: false,
    previewApprovalConfigured: true,
    maxXlmPerRun: 10000,
    maxXlmPerDay: 10000,
  },
  failuresLast24Hours: { autoSend: 0, tieredRewards: 0 },
  warnings: [],
};

describe("production health check", () => {
  it("accepts a healthy response with the approved limits", () => {
    expect(evaluateHealth(healthy, { maxXlmPerRun: 10000, maxXlmPerDay: 10000 })).toEqual([]);
  });

  it("flags incidents that the endpoint's ok field does not include", () => {
    expect(evaluateHealth({ ...healthy, failuresLast24Hours: { autoSend: 1, tieredRewards: 0 }, warnings: ["Payment failures occurred in the last 24 hours"] }))
      .toContain("Payment failures occurred in the last 24 hours");
    expect(evaluateHealth({ ...healthy, mainnet: { ...healthy.mainnet, maxXlmPerDay: 500 } }, { maxXlmPerDay: 10000 }))
      .toContain("Daily XLM limit differs from the approved value");
    expect(evaluateHealth({ ...healthy, encryption: { configured: true, plaintextSecrets: 1 } }))
      .toContain("Plaintext signing keys remain");
  });

  it("passes the bearer token only in the request and omits it from HTTP errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(checkProductionHealth({ baseUrl: "https://example.com/", bearerToken: "private-token", fetchImpl }))
      .rejects.toThrow("Health endpoint returned HTTP 401");
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/api/admin/health", expect.objectContaining({
      headers: { Authorization: "Bearer private-token" },
    }));
  });
});
