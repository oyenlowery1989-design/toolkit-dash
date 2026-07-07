export interface DestinationSummary {
  address: string;
  totalXlm: number;
  count: number;
}

export interface ProceedsLedgerEntry {
  id: string;
  account: string;
  category:
    | "dex_sale"
    | "path_sale"
    | "payment"
    | "create_account"
    | "path_native_out"
    | "account_merge"
    | "fee";
  amountXlm: number;
  assetSoldAmount?: number;
  txHash: string;
  createdAt: string;
  from?: string;
  to?: string;
  successful: boolean;
}

export interface AssetProceedsResult {
  assetCode: string;
  issuer: string;
  accounts: string[];
  totalAssetSold: number;
  totalXlmProceeds: number;
  totalOutgoingXlm: number;
  estimatedOnHandXlm: number;
  dexTradeCount: number;
  pathSaleCount: number;
  proceedsLedger: ProceedsLedgerEntry[];
  outgoingLedger: ProceedsLedgerEntry[];
  topDestinations: DestinationSummary[];
}

export interface CounterpartySummary {
  address: string;
  totalXlm: number;
  count: number;
}

export interface AddressLedgerEntry {
  id: string;
  direction: "incoming" | "outgoing";
  category:
    | "payment"
    | "create_account"
    | "path_payment"
    | "account_merge"
    | "fee";
  amountXlm: number;
  txHash: string;
  createdAt: string;
  from?: string;
  to?: string;
  successful: boolean;
}

export interface AddressInvestigationResult {
  account: string;
  totalIncomingXlm: number;
  totalOutgoingXlm: number;
  totalIncomingFromSendersXlm: number;
  totalOutgoingToRecipientsXlm: number;
  netXlm: number;
  topSenders: CounterpartySummary[];
  topRecipients: CounterpartySummary[];
  incomingLedger: AddressLedgerEntry[];
  outgoingLedger: AddressLedgerEntry[];
  /** False when a pagination loop was cut short by a transient error — result is partial. */
  complete?: boolean;
  /** Human-readable note describing why the result is partial, if applicable. */
  warning?: string;
}

export interface ScanProgress {
  phase: string;
  pages: number;
  records: number;
  /** Number of relevant transactions/trades found so far */
  hits?: number;
}
