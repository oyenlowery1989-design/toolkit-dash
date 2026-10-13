import { fileURLToPath } from "node:url";
import path from "node:path";

export function evaluateHealth(body, expected = {}) {
  if (!body || typeof body !== "object") return ["Health response is not an object"];
  const issues = [];
  if (body.ok !== true) issues.push("Health check reported ok=false");
  if (body.provider !== "supabase") issues.push("Production is not using Supabase");
  if (body.encryption?.configured !== true) issues.push("Signing-key encryption is unavailable");
  if (body.encryption?.plaintextSecrets !== 0) issues.push("Plaintext signing keys remain");
  if (body.browserSigningEnabled !== false) issues.push("Browser access to saved signing keys is enabled");
  if (body.mainnet?.transactionsEnabled !== true) issues.push("Mainnet transactions are disabled");
  if (body.mainnet?.emergencyStop !== false) issues.push("Mainnet emergency stop is active");
  if (body.mainnet?.previewApprovalConfigured !== true) issues.push("Preview approval is unavailable");
  if (expected.maxXlmPerRun !== undefined && body.mainnet?.maxXlmPerRun !== expected.maxXlmPerRun) {
    issues.push("Per-run XLM limit differs from the approved value");
  }
  if (expected.maxXlmPerDay !== undefined && body.mainnet?.maxXlmPerDay !== expected.maxXlmPerDay) {
    issues.push("Daily XLM limit differs from the approved value");
  }
  if ((body.failuresLast24Hours?.autoSend ?? NaN) !== 0 ||
      (body.failuresLast24Hours?.tieredRewards ?? NaN) !== 0) {
    issues.push("Payment failures occurred in the last 24 hours");
  }
  if (!Array.isArray(body.warnings)) issues.push("Health warnings are missing");
  else issues.push(...body.warnings.map((warning) => `Health warning: ${String(warning)}`));
  return [...new Set(issues)];
}

export async function checkProductionHealth({ baseUrl, bearerToken, expected = {}, fetchImpl = fetch }) {
  if (!baseUrl || !/^https:\/\//.test(baseUrl)) throw new Error("HEALTH_BASE_URL must be an HTTPS URL");
  if (!bearerToken) throw new Error("HEALTH_BEARER_TOKEN is required");
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/admin/health`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw new Error("Health endpoint returned invalid JSON"); }
  return evaluateHealth(body, expected);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = {
    maxXlmPerRun: Number(process.env.HEALTH_EXPECT_MAX_XLM_PER_RUN ?? "10000"),
    maxXlmPerDay: Number(process.env.HEALTH_EXPECT_MAX_XLM_PER_DAY ?? "10000"),
  };
  try {
    const issues = await checkProductionHealth({
      baseUrl: process.env.HEALTH_BASE_URL,
      bearerToken: process.env.HEALTH_BEARER_TOKEN,
      expected,
    });
    if (issues.length > 0) {
      console.error(`Production health check failed: ${issues.join("; ")}`);
      process.exitCode = 1;
    } else {
      console.log("Production health check passed");
    }
  } catch (error) {
    console.error(`Production health check failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exitCode = 1;
  }
}
