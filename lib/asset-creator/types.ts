// lib/asset-creator/types.ts
import type { Horizon } from "stellar-sdk";
import type { Network } from "@/lib/settings";

export interface AssetCreatorForm {
  network: Network;
  issuerPublicKey: string;
  issuerSecretKey: string;
  distributorPublicKey: string;
  distributorSecretKey: string;
  /** Resolved by panel: activeWallet.secretKey ?? manualFundingSecretKey. Empty string if mainnet funding not needed. */
  resolvedFundingSecretKey: string;
  assetCode: string;     // case preserved — never uppercased
  tokenName: string;     // "" if not provided; TOML only
  supply: number;
  memo: string;          // "" if not provided; applied to issuance tx only
  homeDomain: string;    // "" if not provided
}

export interface SignedTx {
  stepId: "fund-accounts" | "set-home-domain" | "trustline" | "issuance";
  label: string;
  xdr: string;           // base64 XDR of signed transaction envelope
  sourceAccount: string; // account whose sequence number was used
}

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface StepResult {
  stepId: SignedTx["stepId"] | "friendbot";
  status: StepStatus;
  txHash?: string;
  error?: string;
}

export interface PreflightCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warning" | "loading";
  message?: string;  // shown on fail/warning
  blocking: boolean; // if true blocks execute; if false requires checkbox ack
}

export interface PreflightResult {
  checks: PreflightCheck[];
  estimatedFeesXlm: string; // e.g. "0.0004"
  allBlockingPassed: boolean;
}

export interface CreationResult {
  steps: StepResult[];
  groupId?: string;
}

export interface CreationStrategy {
  id: string;
  label: string;
  /**
   * Build signed transactions for the given stepIds only.
   * Sequence numbers fetched from Horizon inside this call — never pre-fetched.
   * @param steps - subset of stepIds to build (enables incremental retry)
   * @param signal - AbortSignal for cancelling in-flight Horizon calls
   */
  buildTransactions(
    form: AssetCreatorForm,
    steps: Array<SignedTx["stepId"]>,
    server: Horizon.Server,
    networkPassphrase: string,
    signal: AbortSignal,
  ): Promise<SignedTx[]>;
}
