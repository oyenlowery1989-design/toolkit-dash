import { createHmac, timingSafeEqual } from "node:crypto";

export interface MainnetSafetyConfig {
  transactionsEnabled: boolean;
  emergencyStop: boolean;
  maxXlmPerRun: number;
  maxXlmPerDay: number;
  maxOperationsPerRun: number;
  allowedDestinations: Set<string>;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getMainnetSafetyConfig(): MainnetSafetyConfig {
  return {
    transactionsEnabled: process.env.MAINNET_TRANSACTIONS_ENABLED === "true",
    emergencyStop: process.env.MAINNET_EMERGENCY_STOP === "true",
    maxXlmPerRun: positiveNumber(process.env.MAINNET_MAX_XLM_PER_RUN, 100),
    maxXlmPerDay: positiveNumber(process.env.MAINNET_MAX_XLM_PER_DAY, 500),
    maxOperationsPerRun: Math.floor(positiveNumber(process.env.MAINNET_MAX_OPERATIONS_PER_RUN, 100)),
    allowedDestinations: new Set(
      (process.env.MAINNET_ALLOWED_DESTINATIONS ?? "")
        .split(",")
        .map((address) => address.trim())
        .filter(Boolean),
    ),
  };
}

export interface MainnetRunIntent {
  destinations: string[];
  operationCount: number;
  xlmAmount: number;
  xlmSentLast24Hours?: number;
}

export function validateMainnetRun(intent: MainnetRunIntent): string[] {
  const config = getMainnetSafetyConfig();
  const errors: string[] = [];
  if (!config.transactionsEnabled) errors.push("Mainnet transactions are disabled by server policy");
  if (config.emergencyStop) errors.push("Mainnet emergency stop is active");
  if (intent.operationCount > config.maxOperationsPerRun) {
    errors.push(`Run has ${intent.operationCount} operations; limit is ${config.maxOperationsPerRun}`);
  }
  if (intent.xlmAmount > config.maxXlmPerRun + 1e-7) {
    errors.push(`Run would send ${intent.xlmAmount.toFixed(7)} XLM; limit is ${config.maxXlmPerRun}`);
  }
  if ((intent.xlmSentLast24Hours ?? 0) + intent.xlmAmount > config.maxXlmPerDay + 1e-7) {
    errors.push(`Daily XLM limit of ${config.maxXlmPerDay} would be exceeded`);
  }
  if (config.allowedDestinations.size > 0) {
    const blocked = [...new Set(intent.destinations)].filter((address) => !config.allowedDestinations.has(address));
    if (blocked.length > 0) errors.push(`${blocked.length} destination(s) are not on the mainnet allowlist`);
  }
  return errors;
}

function approvalSecret(): string | null {
  const configured = process.env.PREVIEW_APPROVAL_SECRET?.trim();
  if (configured) return configured;
  // Keep local development convenient, but require key separation anywhere real
  // mainnet transactions can be submitted.
  if (process.env.NODE_ENV !== "production") {
    return process.env.SIGNING_KEY_ENCRYPTION_KEY?.trim() || null;
  }
  return null;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createPreviewApproval(subject: string, userId: string, digest: string, now = Date.now()): string | null {
  const secret = approvalSecret();
  if (!secret) return null;
  const payload = encode(JSON.stringify({ subject, userId, digest, expiresAt: now + 5 * 60_000 }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyPreviewApproval(
  token: unknown,
  subject: string,
  userId: string,
  digest: string,
  now = Date.now(),
): boolean {
  if (typeof token !== "string") return false;
  const secret = approvalSecret();
  if (!secret) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return parsed.subject === subject
      && parsed.userId === userId
      && parsed.digest === digest
      && typeof parsed.expiresAt === "number"
      && parsed.expiresAt >= now;
  } catch {
    return false;
  }
}

export function stablePreviewDigest(value: unknown): string {
  return createHmac("sha256", "stellar-toolkit-preview-v1")
    .update(JSON.stringify(value))
    .digest("base64url");
}
