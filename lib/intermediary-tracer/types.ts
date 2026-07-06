// ---------------------------------------------------------------------------
// Intermediary Tracer — Types
// ---------------------------------------------------------------------------

export interface FunderCandidate {
  address: string;
  sentAmount: number;
  asset: string;           // "XLM" or "CODE:ISSUER"
  sentAt: string;          // ISO timestamp
  timeDeltaSec: number;    // seconds before create_account
  amountDiffPct: number;   // % difference from starting_balance
  confidence: number;      // 0–100
}

export interface AccountOriginResult {
  createdAccount: string;
  createdAt: string;
  startingBalance: number;
  intermediary: string;
  pagingToken: string;
  candidates: FunderCandidate[];
  /** True when no incoming XLM payments found in window (may be non-native funding) */
  noNativeCandidates: boolean;
}

export interface TraceResult {
  targetAccount: string;
  createdAt: string;
  startingBalance: number;
  creator: string;
  creatorName?: string;       // from known intermediaries or address book
  isKnownIntermediary: boolean;
  candidates: FunderCandidate[];
  noNativeCandidates: boolean;
}

export interface KnownIntermediary {
  address: string;
  name: string;
  notes?: string;
  addedAt: number;
}

/** A real funder identified behind an intermediary-created account */
export interface KnownCreator {
  address: string;
  name: string;
  notes?: string;
  parentAddress?: string;
  addedAt: number;
}

/** A child account discovered as belonging to a known creator */
export interface CreatorChild {
  id: string;
  creatorAddress: string;
  childAddress: string;
  network: string;
  viaIntermediary?: string;
  createdOnChain?: string;       // ISO timestamp
  confidence?: number;
  startingBalance?: number;
  homeDomain?: string;
  issuedAssets?: { code: string; supply: string }[];
  distributedAssets?: { code: string; issuer: string }[];
  discoveredAt: number;
}

/** One account created for a known creator via an intermediary */
export interface CreatorAccountResult {
  createdAccount: string;
  createdAt: string;
  startingBalance: number;
  /** Payment the creator sent to the intermediary */
  sentAt: string;
  sentAmount: number;
  timeDeltaSec: number;   // seconds between payment and create_account
  amountDiffPct: number;
  confidence: number;
  homeDomain?: string;
}
