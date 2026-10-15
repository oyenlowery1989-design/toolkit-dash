export interface DestinationSummary {
  address: string;
  totalXlm: number;
  count: number;
}

export interface ProceedsLedgerEntry {
  id: string;
  account: string;
  category:
    | "contract_sale"
    | "contract_purchase"
    | "dex_sale"
    | "path_sale"
    | "payment"
    | "create_account"
    | "path_native_out"
    | "account_merge"
    | "fee"
    | "dex_purchase"
    | "path_purchase"
    | "sale_delivery";
  amountXlm: number;
  assetSoldAmount?: number;
  operationId?: string;
  targetAssetPurchase?: boolean;
  txHash: string;
  createdAt: string;
  from?: string;
  to?: string;
  successful: boolean;
  memo?: import("./beneficiaries").TransactionMemo;
  toMuxed?: string;
  toMuxedId?: string;
}

export interface AssetProceedsResult {
  assetCode: string;
  issuer: string;
  accounts: string[];
  totalAssetSold: number;
  totalXlmProceeds: number;
  totalOutgoingXlm: number;
  estimatedOnHandXlm: number;
  contractSaleCount?: number;
  dexTradeCount: number;
  pathSaleCount: number;
  proceedsLedger: ProceedsLedgerEntry[];
  outgoingLedger: ProceedsLedgerEntry[];
  beneficiaryGrouping?: import("./beneficiaries").BeneficiaryGrouping;
  topDestinations: DestinationSummary[];
  sellerAttributions?: import("./selection").SellerAttribution[];
  totalXlmSpentOnPurchases?: number;
  accountWideXlmSpentOnPurchases?: number;
  currentXlmBalance?: number | null;
  purchaseLedger?: ProceedsLedgerEntry[];
  totalInternalTransferXlm?: number;
  internalTransferLedger?: ProceedsLedgerEntry[];
  externalSaleDeliveryXlm?: number;
  saleDeliveryLedger?: ProceedsLedgerEntry[];
  accountSummaries?: Array<{
    account: string;
    totalXlmProceeds: number;
    totalAssetSold: number;
    totalXlmSpentOnPurchases: number;
    accountWideXlmSpentOnPurchases: number;
    totalOutgoingXlm: number;
    currentXlmBalance: number | null;
    confirmedSeller: boolean;
    saleEvidenceIds: string[];
  }>;
  coverage?: {
    requestedFrom: string | null;
    requestedTo: string;
    oldestObserved?: string;
    newestObserved?: string;
    accountHistoryStarts?: Array<{ account: string; createdAt: string; operationId: string; txHash: string }>;
    complete: boolean;
    warnings: string[];
  };
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
