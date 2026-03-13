"use client";

import { createSearchHistory } from "@/hooks/use-search-history";

export interface AssetSearchEntry {
  assetCode: string;
  issuer: string;
  network: string;
  timestamp: number;
}

const { useHistory, getSnapshot } = createSearchHistory<AssetSearchEntry>({
  storageKey: "stellar-toolkit-asset-history",
  eventName: "stellar-toolkit-asset-history-changed",
  maxEntries: 20,
  isDuplicate: (a, b) =>
    a.assetCode === b.assetCode &&
    a.issuer === b.issuer &&
    a.network === b.network,
});

/** Read the current asset history without subscribing to updates. */
export const assetHistoryGetSnapshot = getSnapshot;

export const useAssetHistory = useHistory;
