export type BatchStatus = "pending" | "sending" | "success" | "failed" | "uncertain";

export interface BatchResult {
  batchIndex: number;
  count: number;
  status: BatchStatus;
  txHash?: string;
  signedXdr?: string;
  error?: string;
}

export interface AssetSource {
  assetCode: string;
  issuer: string;
  /** How many holders were fetched (balance > 0) */
  holderCount?: number;
  error?: string;
}

/** Nonsecret data needed to review or safely resume a bulk send after reload. */
export interface BulkPaymentJournal {
  runId: string;
  version: number;
  network: import("@/lib/settings").Network;
  sender: string;
  memo: string;
  amount: string;
  assetCode: string | null;
  assetIssuer: string | null;
  feeMultiplier: number;
  batches: string[][];
  results: BatchResult[];
  status: "sending" | "done";
}
