export interface DestinationSummary {
  address: string;
  totalXlm: number;
  count: number;
}

export interface SellerSummary {
  address: string;
  assetSold: number;
  xlmReceived: number;
  tradeCount: number;
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
  totalOutgoingToRecipientsXlm: number;
  netXlm: number;
  topSenders: CounterpartySummary[];
  topRecipients: CounterpartySummary[];
  incomingLedger: AddressLedgerEntry[];
  outgoingLedger: AddressLedgerEntry[];
}

export interface ScanProgress {
  phase: string;
  pages: number;
  records: number;
  /** Number of relevant transactions/trades found so far */
  hits?: number;
}
