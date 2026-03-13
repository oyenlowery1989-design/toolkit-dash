"use client";

import { createSearchHistory } from "@/hooks/use-search-history";
import type { Network } from "@/lib/settings";

export interface IntermediarySearchEntry {
  address: string;
  network: Network;
  name?: string; // known intermediary name if any
  timestamp: number;
}

const { useHistory, getSnapshot } = createSearchHistory<IntermediarySearchEntry>({
  storageKey: "stellar-toolkit-intermediary-history",
  eventName: "stellar-toolkit-intermediary-history-changed",
  maxEntries: 20,
  isDuplicate: (a, b) => a.address === b.address && a.network === b.network,
});

export const intermediaryHistoryGetSnapshot = getSnapshot;
export const useIntermediaryHistory = useHistory;
