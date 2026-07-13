"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createDbCache, authHeaders, waitForAuth, debounce } from "@/lib/db-client";
import type { TieredRewardConfig, Tier, RewardAsset } from "@/lib/tiered-rewards/types";

const ENDPOINT = "/api/db/tiered-rewards";

async function dbAction(action: string, type: string, data: Record<string, unknown>): Promise<void> {
  await waitForAuth();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ type, action, data }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `POST ${ENDPOINT} failed: ${res.status}`);
  }
}

function handleActionError(e: unknown) {
  toast.error(e instanceof Error ? e.message : "Save failed");
  _cache.reload(ENDPOINT);
}

function triggerSchedulerRefresh() {
  waitForAuth().then(() =>
    fetch("/api/tiered-rewards/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ mode: "refresh-scheduler" }),
    })
  ).catch(() => {});
}

const _cache = createDbCache<TieredRewardConfig>();

export function useTieredRewardConfigs() {
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

  const configs = _cache.get();

  const createConfig = useCallback(
    (entry: Omit<TieredRewardConfig, "id" | "createdAt" | "tiers" | "lastRunAt" | "lastFailureAt">) => {
      const id = crypto.randomUUID();
      const optimistic: TieredRewardConfig = { ...entry, id, createdAt: Date.now(), tiers: [] };
      _cache.set([optimistic, ..._cache.get()]);
      dbAction("create", "config", { id, ...entry }).catch(handleActionError);
      if (entry.intervalMinutes) triggerSchedulerRefresh();
    },
    []
  );

  const updateConfig = useCallback(
    (id: string, updates: Partial<Omit<TieredRewardConfig, "tiers">>) => {
      _cache.set(_cache.get().map((c) => (c.id === id ? { ...c, ...updates } : c)));
      dbAction("update", "config", { id, ...updates }).catch(handleActionError);
      if (updates.enabled !== undefined || updates.intervalMinutes !== undefined) {
        triggerSchedulerRefresh();
      }
    },
    []
  );

  const deleteConfig = useCallback((id: string) => {
    _cache.set(_cache.get().filter((c) => c.id !== id));
    dbAction("delete", "config", { id }).catch(handleActionError);
    triggerSchedulerRefresh();
  }, []);

  const upsertTier = useCallback(
    (configId: string, tier: Omit<Tier, "id" | "configId" | "assets"> & { id?: string; assets?: RewardAsset[] }) => {
      const id = tier.id ?? crypto.randomUUID();
      // Decide create-vs-update by actual cache membership, computed BEFORE the optimistic
      // mutation below — not by whether the caller supplied an id. Tier import/replace
      // pre-generates an id for a brand-new tier (so it can attach child assets immediately),
      // and `tier.id ? "update" : "create"` would misfire "update" against a row that doesn't
      // exist yet (silent no-op on SQLite, 404 on Supabase).
      const exists = _cache.get().some((c) => c.id === configId && c.tiers.some((t) => t.id === id));
      const full: Tier = { ...tier, id, configId, assets: tier.assets ?? [] };
      _cache.set(
        _cache.get().map((c) => {
          if (c.id !== configId) return c;
          const existing = c.tiers.findIndex((t) => t.id === id);
          const tiers = existing >= 0
            ? c.tiers.map((t) => (t.id === id ? full : t))
            : [...c.tiers, full];
          return { ...c, tiers };
        })
      );
      // Returned so callers that need to sequence tier-then-asset creation (e.g. tier
      // import/replace) can await actual completion instead of firing unawaited in parallel.
      return dbAction(exists ? "update" : "create", "tier", { id, configId, ...tier }).catch(handleActionError);
    },
    []
  );

  const deleteTier = useCallback((configId: string, tierId: string) => {
    _cache.set(
      _cache.get().map((c) => {
        if (c.id !== configId) return c;
        return { ...c, tiers: c.tiers.filter((t) => t.id !== tierId) };
      })
    );
    // Returned so callers that need to sequence a delete-then-create (e.g. tier import/replace)
    // can await the request's actual completion instead of firing both unawaited in parallel.
    return dbAction("delete", "tier", { id: tierId }).catch(handleActionError);
  }, []);

  const upsertRewardAsset = useCallback(
    (configId: string, tierId: string, asset: Omit<RewardAsset, "id" | "tierId"> & { id?: string }) => {
      const id = asset.id ?? crypto.randomUUID();
      const full: RewardAsset = { ...asset, id, tierId };
      _cache.set(
        _cache.get().map((c) => {
          if (c.id !== configId) return c;
          return {
            ...c,
            tiers: c.tiers.map((t) => {
              if (t.id !== tierId) return t;
              const existing = t.assets.findIndex((a) => a.id === id);
              const assets = existing >= 0
                ? t.assets.map((a) => (a.id === id ? full : a))
                : [...t.assets, full];
              return { ...t, assets };
            }),
          };
        })
      );
      dbAction(asset.id ? "update" : "create", "asset", { id, tierId, ...asset }).catch(handleActionError);
    },
    []
  );

  const deleteRewardAsset = useCallback((configId: string, tierId: string, assetId: string) => {
    _cache.set(
      _cache.get().map((c) => {
        if (c.id !== configId) return c;
        return {
          ...c,
          tiers: c.tiers.map((t) => {
            if (t.id !== tierId) return t;
            return { ...t, assets: t.assets.filter((a) => a.id !== assetId) };
          }),
        };
      })
    );
    dbAction("delete", "asset", { id: assetId }).catch(handleActionError);
  }, []);

  return {
    configs,
    isLoaded: _cache.isLoaded(),
    createConfig,
    updateConfig,
    deleteConfig,
    upsertTier,
    deleteTier,
    upsertRewardAsset,
    deleteRewardAsset,
    reload: () => _cache.load(ENDPOINT),
  };
}
