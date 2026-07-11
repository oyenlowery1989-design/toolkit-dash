"use client";

import { createSearchHistory } from "@/hooks/use-search-history";
import type { Network } from "@/lib/settings";

export interface ProceedsSearchEntry {
  assetsText: string;
  network: Network;
  assetCount: number;
  timestamp: number;
}

const { useHistory, getSnapshot } = createSearchHistory<ProceedsSearchEntry>({
  storageKey: "stellar-toolkit-bulk-proceeds-history",
  eventName: "stellar-toolkit-bulk-proceeds-history-changed",
  maxEntries: 20,
  isDuplicate: (a, b) => a.assetsText === b.assetsText && a.network === b.network,
});

/** Read the current asset-sales search history without subscribing to updates. */
export const proceedsHistoryGetSnapshot = getSnapshot;

export const useProceedsHistory = useHistory;
