import { Horizon, Keypair } from "stellar-sdk";
import type { TieredRewardConfig, TierAssignment, TierCostItem, RewardsPreview } from "./types";
import { fetchHolders, assignHoldersToTiers } from "./fetcher";
import { BASE_FEE } from "@/lib/bulk-payments/builder";

const { Server } = Horizon;

const HORIZON_URLS: Record<string, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

/**
 * Fee-safety-margin scaled to the actual expected operation count (holders × reward
 * assets per tier) and the configured fee multiplier — a flat constant under-estimates
 * cost for large-holder configs or an elevated feeMultiplier during network congestion,
 * letting a run pass preflight but fail partway through execution on insufficient fee
 * balance. Mirrors the per-op fee formula in lib/bulk-payments/builder.ts (estimateCost)
 * and lib/tiered-rewards/runner.ts's baseFee calc.
 */
export function estimateFeeBudget(assignments: TierAssignment[], feeMultiplier: number): number {
  const estimatedOpCount = assignments.reduce(
    (sum, a) => sum + a.holders.length * a.tier.assets.length,
    0
  );
  const feePerOpStroops = parseInt(BASE_FEE) * Math.max(1, Math.round(feeMultiplier));
  return (estimatedOpCount * feePerOpStroops) / 1e7;
}

async function loadSenderAssetBalances(
  server: InstanceType<typeof Server>,
  senderAddress: string,
  assetKeys: Set<string>
): Promise<Map<string, { balance: number; hasTrustline: boolean }>> {
  const result = new Map<string, { balance: number; hasTrustline: boolean }>();
  if (assetKeys.size === 0) return result;

  const account = await server.loadAccount(senderAddress);
  for (const key of assetKeys) {
    const [code, issuer] = key.split(":");
    // If sender IS the issuer, they can send unlimited — no trustline needed
    if (issuer === senderAddress) {
      result.set(key, { balance: Number.MAX_SAFE_INTEGER, hasTrustline: true });
      continue;
    }
    const entry = account.balances.find(
      (b: { asset_type: string; asset_code?: string; asset_issuer?: string }) =>
        (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
        b.asset_code?.toUpperCase() === code.toUpperCase() &&
        b.asset_issuer === issuer
    ) as { balance: string } | undefined;
    result.set(key, {
      balance: entry ? parseFloat(entry.balance) : 0,
      hasTrustline: !!entry,
    });
  }
  return result;
}

export async function calculatePreview(
  config: TieredRewardConfig,
  signal?: AbortSignal
): Promise<RewardsPreview | { error: string }> {
  const horizonUrl = HORIZON_URLS[config.network] ?? HORIZON_URLS.public;
  const server = new Server(horizonUrl);

  // No key = holder-only preview (tier assignments without balance/cost check)
  if (!config.secretKey) {
    let holders;
    try {
      holders = await fetchHolders(config.assetCode, config.assetIssuer, config.network, signal);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const excludeSet = new Set(config.excludeAddresses ?? []);
    const filtered = holders.filter((h) => !excludeSet.has(h.address));
    const assignments = assignHoldersToTiers(filtered, config.tiers);
    return {
      configId: config.id,
      senderAddress: "",
      xlmBalance: 0,
      assignments,
      costItems: [],
      blocked: true,
      blockReasons: ["Sender secret key required to check balances and execute"],
      holderOnlyPreview: true,
    };
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(config.secretKey);
  } catch {
    return { error: "Invalid secret key" };
  }
  const senderAddress = keypair.publicKey();

  let xlmBalance: number;
  try {
    const account = await server.loadAccount(senderAddress);
    const native = account.balances.find((b: { asset_type: string }) => b.asset_type === "native") as { balance: string } | undefined;
    xlmBalance = parseFloat(native?.balance ?? "0");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg.includes("404") ? `Sender account not found on ${config.network}` : msg.slice(0, 150) };
  }

  let holders;
  try {
    holders = await fetchHolders(config.assetCode, config.assetIssuer, config.network, signal);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const excludeSet = new Set(config.excludeAddresses ?? []);
  const filteredHolders = holders.filter((h) => !excludeSet.has(h.address));
  const assignments = assignHoldersToTiers(filteredHolders, config.tiers);

  const nonNativeKeys = new Set<string>();
  for (const assignment of assignments) {
    for (const asset of assignment.tier.assets) {
      if (asset.assetCode.toUpperCase() !== "XLM" && asset.assetIssuer) {
        nonNativeKeys.add(`${asset.assetCode}:${asset.assetIssuer}`);
      }
    }
  }

  const assetBalances = await loadSenderAssetBalances(server, senderAddress, nonNativeKeys);

  const feeBudget = estimateFeeBudget(assignments, config.feeMultiplier ?? 1.0);
  const costMap = new Map<string, { required: number; senderBalance: number; hasTrustline: boolean; code: string; issuer?: string }>();

  for (const assignment of assignments) {
    const holderCount = assignment.holders.length;
    if (holderCount === 0) continue;

    for (const asset of assignment.tier.assets) {
      const isNative = asset.assetCode.toUpperCase() === "XLM";
      const key = isNative ? "XLM" : `${asset.assetCode}:${asset.assetIssuer}`;
      const required = asset.amount * holderCount;

      if (!costMap.has(key)) {
        if (isNative) {
          const spendable = Math.max(0, xlmBalance - config.minReserve - feeBudget);
          costMap.set(key, { required: 0, senderBalance: spendable, hasTrustline: true, code: "XLM" });
        } else {
          const info = assetBalances.get(key) ?? { balance: 0, hasTrustline: false };
          costMap.set(key, { required: 0, senderBalance: info.balance, hasTrustline: info.hasTrustline, code: asset.assetCode, issuer: asset.assetIssuer });
        }
      }
      const entry = costMap.get(key)!;
      entry.required += required;
    }
  }

  const costItems: TierCostItem[] = Array.from(costMap.entries()).map(([, v]) => ({
    assetCode: v.code,
    assetIssuer: v.issuer,
    totalRequired: v.required,
    senderBalance: v.senderBalance,
    hasTrustline: v.hasTrustline,
    shortfall: Math.max(0, v.required - v.senderBalance),
  }));

  const blockReasons: string[] = [];

  // Check min sender threshold — blocks the run if balance is too low (mirrors the
  // identical guard in lib/auto-send/runner.ts: `group.minSenderThreshold > 0 && xlmBalance < group.minSenderThreshold`)
  if (config.minSenderThreshold > 0 && xlmBalance < config.minSenderThreshold) {
    blockReasons.push(
      `Balance ${xlmBalance.toFixed(2)} XLM below sender threshold (${config.minSenderThreshold} XLM)`
    );
  }

  for (const item of costItems) {
    if (!item.hasTrustline) {
      blockReasons.push(`Sender has no trustline for ${item.assetCode}:${item.assetIssuer}`);
    } else if (item.shortfall > 0) {
      blockReasons.push(
        `Insufficient ${item.assetCode}: need ${item.totalRequired.toFixed(7)}, have ${item.senderBalance.toFixed(7)} (shortfall ${item.shortfall.toFixed(7)})`
      );
    }
  }

  return {
    configId: config.id,
    senderAddress,
    xlmBalance,
    assignments,
    costItems,
    blocked: blockReasons.length > 0,
    blockReasons,
  };
}
