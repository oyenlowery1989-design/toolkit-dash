// lib/asset-creator/preflight.ts
import type { Horizon } from "stellar-sdk";
import type { PreflightCheck } from "./types";

export async function checkAccountExists(
  address: string,
  server: Horizon.Server,
  onLog: (msg: string) => void,
  signal: AbortSignal,
  horizonUrl = "",
): Promise<PreflightCheck> {
  onLog(`  GET ${horizonUrl}/accounts/${address}`);
  try {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    await server.loadAccount(address);
    return { id: `exists-${address}`, label: `Account ${address.slice(0, 4)}…${address.slice(-4)} exists`, status: "pass", blocking: true };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const is404 = (e as { response?: { status?: number } })?.response?.status === 404;
    return {
      id: `exists-${address}`,
      label: `Account ${address.slice(0, 4)}…${address.slice(-4)} exists`,
      status: "fail",
      message: is404 ? "Account not found — enable funding to create it" : "Could not reach Horizon",
      blocking: true,
    };
  }
}

export async function checkBalance(
  address: string,
  minXlm: number,
  server: Horizon.Server,
  onLog: (msg: string) => void,
  signal: AbortSignal,
  horizonUrl = "",
): Promise<PreflightCheck> {
  onLog(`  GET ${horizonUrl}/accounts/${address} (balance check)`);
  try {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const account = await server.loadAccount(address);
    const native = account.balances.find((b: { asset_type: string }) => b.asset_type === "native");
    const balance = native ? parseFloat((native as { balance: string }).balance) : 0;
    const pass = balance >= minXlm;
    return {
      id: `balance-${address}`,
      label: `${address.slice(0, 4)}…${address.slice(-4)} has ≥ ${minXlm} XLM`,
      status: pass ? "pass" : "fail",
      message: pass ? undefined : `Balance is ${balance.toFixed(2)} XLM — need at least ${minXlm} XLM`,
      blocking: true,
    };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { id: `balance-${address}`, label: `Balance check`, status: "fail", message: "Could not load account", blocking: true };
  }
}

export async function checkAssetExists(
  assetCode: string,
  issuer: string,
  server: Horizon.Server,
  onLog: (msg: string) => void,
  signal: AbortSignal,
  horizonUrl = "",
): Promise<PreflightCheck> {
  onLog(`  GET ${horizonUrl}/assets?asset_code=${assetCode}&asset_issuer=${issuer}`);
  try {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const result = await server.assets().forCode(assetCode).forIssuer(issuer).call();
    const exists = result.records.length > 0;
    return {
      id: "asset-exists",
      label: `Asset ${assetCode} not yet issued`,
      status: exists ? "warning" : "pass",
      message: exists ? `${assetCode} is already issued by this account — proceeding will re-issue` : undefined,
      blocking: false,
    };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { id: "asset-exists", label: `Asset ${assetCode} check`, status: "pass", blocking: false };
  }
}

export async function estimateFees(server: Horizon.Server): Promise<string> {
  const stats = await server.feeStats();
  const p50 = parseFloat(stats.fee_charged.p50);
  const totalStroops = p50 * 4; // max 4 transactions in this flow
  return (totalStroops / 10_000_000).toFixed(7);
}
