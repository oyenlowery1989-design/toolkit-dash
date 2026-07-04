"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbDelete, debounce } from "@/lib/db-client";
import type { Network } from "@/lib/settings";

export interface SavedRecipientList {
  id: string;
  name: string;
  network: Network;
  /** Deduplicated addresses, one per entry. */
  addresses: string[];
  /** Original asset query text (CODE:ISSUER lines) if saved from Asset Holders tab. */
  assetsText?: string;
  savedAt: number;
}

const ENDPOINT = "/api/db/bulk-recipients";
const _cache = createDbCache<SavedRecipientList>();

export function useBulkRecipients() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);
    const onFocus = debounce(() => _cache.reload(ENDPOINT), 2000);
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const all = _cache.get();

  /** Save or overwrite a list (same name + network = overwrite). */
  const save = useCallback(
    (
      name: string,
      network: Network,
      addresses: string[],
      assetsText?: string,
    ) => {
      const current = _cache.get();
      const existing = current.find(
        (l) => l.name === name && l.network === network,
      );
      const entry: SavedRecipientList = {
        id: existing?.id ?? String(Date.now()),
        name,
        network,
        addresses,
        ...(assetsText ? { assetsText } : {}),
        savedAt: Date.now(),
      };
      const next = existing
        ? current.map((l) => (l.id === existing.id ? entry : l))
        : [entry, ...current];
      _cache.set(next);
      dbPost(ENDPOINT, entry).catch(() => _cache.reload(ENDPOINT));
    },
    [],
  );

  const remove = useCallback((id: string) => {
    _cache.set(_cache.get().filter((l) => l.id !== id));
    dbDelete(ENDPOINT, id).catch(() => _cache.reload(ENDPOINT));
  }, []);

  /** All lists for a specific network, newest first. */
  const forNetwork = useCallback(
    (network: Network) =>
      all
        .filter((l) => l.network === network)
        .sort((a, b) => b.savedAt - a.savedAt),
    [all],
  );

  return { all, save, remove, forNetwork };
}
