export interface AutoSendDestination {
  id: string;
  groupId: string;
  destination: string;
  /** Fixed split percentage (0–100). Ignored when isRemainder=true. */
  percentage: number;
  /** If true, this destination receives whatever is left after all fixed-% destinations are paid. */
  isRemainder: boolean;
  label?: string;
  memo?: string;
  minThreshold: number;
  /** If > 0, clamp calculated amount to this cap. */
  maxCap: number;
  paused: boolean;
  position: number;
}

export interface AutoSendGroup {
  id: string;
  name: string;
  network: string;
  secretKey: string;
  /** True when a key is saved server-side; secretKey will be "" on GET responses. */
  hasKey?: boolean;
  intervalMinutes: number | null;
  enabled: boolean;
  batchSend: boolean;
  batchMemo?: string;
  minReserve: number;
  /** Don't run the group at all if wallet balance < this threshold. 0 = disabled. */
  minSenderThreshold: number;
  /** If true, scheduler runs a preview only — no real transactions submitted. */
  previewOnly: boolean;
  /** Timestamp of the last scheduled run that had failures. Null if none or cleared. */
  lastFailureAt?: number | null;
  /** Runtime-only flag (not stored in DB) — when true, runner sends 0.0000001 XLM to each dest. */
  testMode?: boolean;
  createdAt: number;
  destinations: AutoSendDestination[];
}

export interface RunLogEntry {
  ranAt: number;
  walletAddress: string;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  previewCount: number;
  totalXlm: number;
  results: { destination: string; status: string; amountSent?: number; txHash?: string; error?: string }[];
}

export interface PreviewItem {
  destination: string;
  label?: string;
  memo?: string;
  percentage: number;
  isRemainder: boolean;
  amountXlm: number;
  wouldSkip: boolean;
  skipReason?: string;
}

export interface GroupPreview {
  groupId: string;
  walletAddress: string;
  xlmBalance: number;
  spendable: number;
  batchSend: boolean;
  estimatedFees: number;
  items: PreviewItem[];
}

export type RunStatus = "sent" | "skipped" | "failed" | "preview";

export interface DestinationRunResult {
  destination: string;
  label?: string;
  status: RunStatus;
  amountSent?: number;
  txHash?: string;
  error?: string;
}

export interface GroupRunResult {
  groupId: string;
  walletAddress: string;
  ranAt: number;
  results: DestinationRunResult[];
}
