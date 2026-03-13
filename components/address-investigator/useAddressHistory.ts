"use client";

import { createSearchHistory } from "@/hooks/use-search-history";
import type { Network } from "@/lib/settings";

export interface AddressSearchEntry {
  address: string;
  network: Network;
  timestamp: number;
}

const { useHistory, getSnapshot } = createSearchHistory<AddressSearchEntry>({
  storageKey: "stellar-toolkit-address-history",
  eventName: "stellar-toolkit-address-history-changed",
  maxEntries: 20,
  isDuplicate: (a, b) => a.address === b.address && a.network === b.network,
});

/** Read the current address history without subscribing to updates. */
export const addressHistoryGetSnapshot = getSnapshot;

export const useAddressHistory = useHistory;
