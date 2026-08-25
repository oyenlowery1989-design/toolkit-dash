import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewApproval, getMainnetSafetyConfig, stablePreviewDigest, validateMainnetRun, verifyPreviewApproval } from "@/lib/mainnet-safety";

const original = { ...process.env };
afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});

describe("mainnet safety policy", () => {
  it("fails closed until transaction execution is explicitly enabled", () => {
    delete process.env.MAINNET_TRANSACTIONS_ENABLED;
    expect(validateMainnetRun({ destinations: [], operationCount: 0, xlmAmount: 0 }))
      .toContain("Mainnet transactions are disabled by server policy");
  });

  it("enforces emergency stop, per-run, daily, operation, and allowlist limits", () => {
    process.env.MAINNET_TRANSACTIONS_ENABLED = "true";
    process.env.MAINNET_EMERGENCY_STOP = "true";
    process.env.MAINNET_MAX_XLM_PER_RUN = "5";
    process.env.MAINNET_MAX_XLM_PER_DAY = "10";
    process.env.MAINNET_MAX_OPERATIONS_PER_RUN = "2";
    process.env.MAINNET_ALLOWED_DESTINATIONS = "GALLOW";
    const errors = validateMainnetRun({
      destinations: ["GALLOW", "GBLOCK"], operationCount: 3, xlmAmount: 6, xlmSentLast24Hours: 5,
    });
    expect(errors).toHaveLength(5);
  });

  it("accepts a run inside every configured boundary", () => {
    process.env.MAINNET_TRANSACTIONS_ENABLED = "true";
    process.env.MAINNET_MAX_XLM_PER_RUN = "5";
    process.env.MAINNET_MAX_XLM_PER_DAY = "10";
    process.env.MAINNET_MAX_OPERATIONS_PER_RUN = "2";
    process.env.MAINNET_ALLOWED_DESTINATIONS = "GALLOW";
    expect(validateMainnetRun({ destinations: ["GALLOW"], operationCount: 1, xlmAmount: 4, xlmSentLast24Hours: 5 })).toEqual([]);
    expect(getMainnetSafetyConfig().maxXlmPerRun).toBe(5);
  });
});

describe("preview approvals", () => {
  it("binds approval to user, subject, digest, and a five-minute expiry", () => {
    process.env.PREVIEW_APPROVAL_SECRET = "approval-secret";
    const digest = stablePreviewDigest({ amount: 4, destination: "GALLOW" });
    const token = createPreviewApproval("auto-send:1", "user-1", digest, 1_000)!;
    expect(verifyPreviewApproval(token, "auto-send:1", "user-1", digest, 2_000)).toBe(true);
    expect(verifyPreviewApproval(token, "auto-send:1", "user-2", digest, 2_000)).toBe(false);
    expect(verifyPreviewApproval(token, "auto-send:1", "user-1", "changed", 2_000)).toBe(false);
    expect(verifyPreviewApproval(token, "auto-send:1", "user-1", digest, 302_000)).toBe(false);
  });

  it("requires a separate approval secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.PREVIEW_APPROVAL_SECRET;
    process.env.SIGNING_KEY_ENCRYPTION_KEY = "encryption-only";
    expect(createPreviewApproval("auto-send:1", "user-1", "digest")).toBeNull();
  });
});
