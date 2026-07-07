"use client";

import { createSearchHistory } from "@/hooks/use-search-history";
import type { Network } from "@/lib/settings";

export interface ProceedsSearchEntry {
  assetCode: string;
  issuer: string;
  network: Network;
  accountsText: string;
  timestamp: number;
}

const { useHistory, getSnapshot } = createSearchHistory<ProceedsSearchEntry>({
  storageKey: "stellar-toolkit-proceeds-history",
  eventName: "stellar-toolkit-proceeds-history-changed",
  maxEntries: 20,
  isDuplicate: (a, b) =>
    a.assetCode === b.assetCode &&
    a.issuer === b.issuer &&
    a.network === b.network &&
    a.accountsText === b.accountsText,
});

/** Read the current proceeds history without subscribing to updates. */
export const proceedsHistoryGetSnapshot = getSnapshot;

export const useProceedsHistory = useHistory;
