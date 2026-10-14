export type TxStatus =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "uncertain"
  | "success"
  | "error";

export type PaymentTab = "send" | "path" | "claimable" | "feebump" | "sponsorship";

export type PathMode = "strict-receive" | "strict-send";

export interface PaymentLeg {
  id: string;
  /** "native" for XLM, "CODE:ISSUER" for tokens */
  assetKey: string;
  amount: string;
  destination: string;
  removeTrustline?: boolean;
}

export interface AccountBalance {
  /** "native" | "CODE:ISSUER" */
  key: string;
  balance: string;
  assetCode: string;
  assetIssuer: string;
  /** Account's subentry_count (trustlines + offers + signers + data entries) — same for every balance of this account. */
  subentryCount: number;
  /** Account's num_sponsoring — same for every balance of this account. */
  numSponsoring: number;
  /** Account's num_sponsored — same for every balance of this account. */
  numSponsored: number;
  /** This balance's own selling_liabilities — funds locked in the account's open sell offers for this asset. */
  sellingLiabilities: string;
}

export interface PathRecord {
  id: string;
  sourceAssetType: string;
  sourceAssetCode?: string;
  sourceAssetIssuer?: string;
  sourceAmount: string;
  destinationAssetType: string;
  destinationAssetCode?: string;
  destinationAssetIssuer?: string;
  destinationAmount: string;
  path: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }>;
}

export interface ClaimantEntry {
  id: string;
  destination: string;
}
