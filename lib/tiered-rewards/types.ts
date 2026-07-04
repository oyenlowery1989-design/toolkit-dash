export interface RewardAsset {
  id: string;
  tierId: string;
  assetCode: string;       // "XLM" for native
  assetIssuer?: string;    // undefined for native XLM
  amount: number;          // flat amount per holder per run
}

export interface Tier {
  id: string;
  configId: string;
  tierNumber: number;      // 1-based
  minTokens: number;       // inclusive
  maxTokens?: number;      // undefined = open-ended top tier
  position: number;
  assets: RewardAsset[];   // reward assets for this tier
}

export interface TieredRewardConfig {
  id: string;
  name: string;
  assetCode: string;       // asset to scan holders for
  assetIssuer: string;
  network: string;         // "testnet" | "public" | "futurenet"
  secretKey: string | null;  // null on GET responses — key stays server-side
  /** True when a secret key is saved server-side; secretKey will be null on GET responses. */
  hasKey?: boolean;
  intervalMinutes: number | null;  // null = manual only
  enabled: boolean;
  minReserve: number;              // default 10.0 XLM
  minSenderThreshold: number;      // default 0 (disabled)
  previewOnly: boolean;
  batchSend: boolean;              // true = batch 100 ops/tx, false = 1 op/tx
  memo: string | null;             // optional tx memo (max 28 chars)
  feeMultiplier: number;           // base fee multiplier (default 1.0)
  excludeAddresses: string[];      // addresses to exclude from rewards
  lastRunAt?: number;              // Unix ms
  lastFailureAt?: number;          // Unix ms
  createdAt: number;               // Unix ms
  tiers: Tier[];
}

export interface HolderEntry {
  address: string;
  balance: number;         // token balance (parsed float)
}

export interface TierAssignment {
  tier: Tier;
  holders: HolderEntry[];
}

export interface TierCostItem {
  assetCode: string;
  assetIssuer?: string;
  totalRequired: number;   // amount × holderCount
  senderBalance: number;   // current sender balance for this asset
  hasTrustline: boolean;   // sender has trustline (always true for XLM)
  shortfall: number;       // max(0, totalRequired - senderBalance)
}

export interface RewardsPreview {
  configId?: string;       // undefined for Quick Runs
  senderAddress: string;
  xlmBalance: number;
  assignments: TierAssignment[];
  costItems: TierCostItem[];
  blocked: boolean;        // true if any shortfall or missing trustline
  blockReasons: string[];
  holderOnlyPreview?: true; // true when no secret key — cost/balance data unavailable
}

export interface RunLogRow {
  id: string;
  configId?: string;
  tierNumber: number;
  holderAddress: string;
  assetCode: string;
  assetIssuer?: string;
  amountSent: number;
  status: "sent" | "failed" | "skipped" | "aborted" | "preview";
  txHash?: string;
  error?: string;
  ranAt: number;
}
