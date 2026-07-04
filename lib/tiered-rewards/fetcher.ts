import { Horizon, Asset } from "stellar-sdk";
import type { Tier, HolderEntry, TierAssignment } from "./types";

const { Server } = Horizon;

const HORIZON_URLS: Record<string, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

/**
 * Fetches all trustline holders of assetCode:assetIssuer via Horizon.
 * Excludes the issuer account itself and zero-balance accounts.
 * Aborts entire scan if any page fails after MAX_ATTEMPTS attempts.
 */
export async function fetchHolders(
  assetCode: string,
  assetIssuer: string,
  network: string,
  signal?: AbortSignal,
  onLog?: (msg: string) => void
): Promise<HolderEntry[]> {
  const horizonUrl = HORIZON_URLS[network] ?? HORIZON_URLS.public;
  const server = new Server(horizonUrl);

  const holders: HolderEntry[] = [];
  let cursor: string | undefined;

  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    let page: any;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const url = `${horizonUrl}/accounts?asset=${assetCode}:${assetIssuer}&limit=200${cursor ? `&cursor=${cursor}` : ""}`;
      onLog?.(`  GET ${url}`);
      try {
        let builder = server.accounts().forAsset(new Asset(assetCode, assetIssuer)).limit(200);
        if (cursor) builder = (builder as any).cursor(cursor);
        page = await (builder as any).call();
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * Math.pow(2, attempt)));
        }
      }
    }

    if (lastErr !== undefined) {
      throw new Error(`Failed to fetch holders page: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    }

    const records = page.records as Array<{
      id: string;
      balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }>;
      paging_token: string;
    }>;

    if (records.length === 0) break;

    for (const record of records) {
      // Exclude issuer account
      if (record.id === assetIssuer) continue;

      const balanceEntry = record.balances.find(
        (b) =>
          (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
          b.asset_code === assetCode &&
          b.asset_issuer === assetIssuer
      );
      if (!balanceEntry) continue;

      const balance = parseFloat(balanceEntry.balance);
      if (balance <= 0) continue;

      holders.push({ address: record.id, balance });
    }

    // Always advance cursor from the last record — must happen outside the filter block
    // to prevent infinite loop when an entire page is filtered out (issuer/zero-balance)
    cursor = records[records.length - 1].paging_token;

    if (records.length < 200) break;
  }

  return holders;
}

/**
 * Assigns each holder to the first matching tier.
 * Tiers are checked in tier_number order (ascending).
 * Holders below the lowest tier min_tokens receive nothing (no assignment).
 */
export function assignHoldersToTiers(
  holders: HolderEntry[],
  tiers: Tier[]
): TierAssignment[] {
  const sorted = [...tiers].sort((a, b) => a.tierNumber - b.tierNumber);
  const assignments: TierAssignment[] = sorted.map((tier) => ({ tier, holders: [] }));

  for (const holder of holders) {
    for (const assignment of assignments) {
      const { minTokens, maxTokens } = assignment.tier;
      const inTier =
        holder.balance >= minTokens &&
        (maxTokens === undefined || maxTokens === null || holder.balance < maxTokens);
      if (inTier) {
        assignment.holders.push(holder);
        break;
      }
    }
  }

  return assignments;
}
