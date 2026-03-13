export interface Holder {
  id: string;
  balance: string;
  limit?: string;
  homeDomain?: string;
}

export interface DistribCandidate {
  address: string;
  reasons: string[];
  confidence: "high" | "medium" | "low";
}

export interface IssuerInfo {
  homeDomain?: string;
  xlmBalance: string;
  authRequired: boolean;
  authRevocable: boolean;
  authClawbackEnabled: boolean;
  authImmutable: boolean;
  createdBy?: string;
}

export interface PaymentTotals {
  totalSentByIssuer: number;
  byAddress: { address: string; total: number; count: number }[];
  otherTotal: number;
  otherCount: number;
}

export interface ClaimableBalanceSummary {
  count: number;
  totalAmount: number;
}

export interface PriceBucket {
  /** Lower bound of price range (XLM per asset, inclusive) */
  priceFrom: number;
  /** Upper bound of price range (XLM per asset, exclusive on last bucket) */
  priceTo: number;
  /** Total asset units sold within this bucket */
  assetSold: number;
  /** Total XLM received within this bucket */
  xlmReceived: number;
  /** Number of individual trades in this bucket */
  count: number;
}

export interface AccountTradeSummary {
  address: string;
  assetSold: number;
  xlmReceived: number;
  tradeCount: number;
  /** XLM received per unit of asset */
  avgPrice: number;
  /** Price distribution histogram */
  priceBuckets: PriceBucket[];
  /** Amount currently listed in open sell offers (not yet sold) */
  openOfferAmount?: number;
}

export interface AssetXlmTradeSummary {
  /** Total asset units sold for XLM across all accounts */
  totalAssetSold: number;
  /** Total XLM received across all accounts */
  totalXlmReceived: number;
  /** Number of individual trades */
  tradeCount: number;
  /** Weighted average price: XLM per asset unit */
  avgPrice: number;
  /** Price distribution histogram (global, all trades) */
  priceBuckets: PriceBucket[];
  /** Breakdown per tracked distrib address */
  byAccount: AccountTradeSummary[];
  /** Top non-distrib sellers discovered from the global pair scan */
  otherSellers: AccountTradeSummary[];
}
