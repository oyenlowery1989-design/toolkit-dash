export type BatchStatus = "pending" | "sending" | "success" | "failed";

export interface BatchResult {
  batchIndex: number;
  count: number;
  status: BatchStatus;
  txHash?: string;
  error?: string;
}

export interface AssetSource {
  assetCode: string;
  issuer: string;
  /** How many holders were fetched (balance > 0) */
  holderCount?: number;
  error?: string;
}
