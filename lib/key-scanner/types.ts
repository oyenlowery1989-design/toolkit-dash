export type KeyScanNetwork = "public" | "testnet" | "futurenet";

export type KeyScanStatus = "stopped" | "running" | "throttled";

export interface KeyScanBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

export type CheckResult =
  | { status: "exists"; balances: KeyScanBalance[]; sequence: string; subentryCount: number }
  | { status: "not-found" }
  | { status: "error"; message: string };

export interface KeyScanTailEntry {
  publicKey: string;
  result: "not-found" | "found" | "error";
  at: number;
}

export interface KeyScanState {
  id: "local";
  network: KeyScanNetwork;
  running: boolean;
  resumeOnBoot: boolean;
  pacedRps: number;
  concurrency: number;
  totalGenerated: number;
  totalNotFound: number;
  totalFound: number;
  totalErrors: number;
  recentTail: KeyScanTailEntry[];
  startedAt: number | null;
  lastActivityAt: number | null;
  lastError: string | null;
  autoResumed?: boolean;
}

export interface KeyScanHit {
  id: string;
  publicKey: string;
  secretKey: string;
  network: KeyScanNetwork;
  xlmBalance: number | null;
  balances: KeyScanBalance[];
  sequence: string | null;
  subentryCount: number | null;
  foundAt: number;
}
