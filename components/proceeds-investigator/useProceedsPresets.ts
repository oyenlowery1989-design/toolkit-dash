"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbDelete } from "@/lib/db-client";
import type { Network } from "@/lib/settings";

export interface ProceedsPresetEntry {
  id: string;
  assetCode: string;
  issuer: string;
  distributionAddress: string;
  network: Network;
  accountsText: string;
  createdAt: number;
}

const ENDPOINT = "/api/db/proceeds-presets";
const _cache = createDbCache<ProceedsPresetEntry>();

export function useProceedsPresets() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);
    return unsub;
  }, []);

  const presets = _cache.get();

  const savePreset = useCallback(
    (entry: Omit<ProceedsPresetEntry, "id" | "createdAt">) => {
      const normalizedAssetCode = entry.assetCode.trim().toUpperCase();
      const normalizedIssuer = entry.issuer.trim();
      const normalizedDistributionAddress = entry.distributionAddress.trim();
      const id = `${normalizedAssetCode}:${normalizedIssuer}:${normalizedDistributionAddress}`;
      const newEntry: ProceedsPresetEntry = {
        ...entry,
        assetCode: normalizedAssetCode,
        issuer: normalizedIssuer,
        distributionAddress: normalizedDistributionAddress,
        id,
        createdAt: Date.now(),
      };
      const current = _cache.get();
      const deduped = current.filter((row) => row.id !== id);
      _cache.set([newEntry, ...deduped].slice(0, 30));
      dbPost(ENDPOINT, newEntry).catch(() => _cache.reload(ENDPOINT));
    },
    [],
  );

  const removePreset = useCallback((id: string) => {
    _cache.set(_cache.get().filter((row) => row.id !== id));
    dbDelete(ENDPOINT, id).catch(() => _cache.reload(ENDPOINT));
  }, []);

  return { presets, savePreset, removePreset };
}
