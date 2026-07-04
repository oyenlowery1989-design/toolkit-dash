"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, authHeaders, waitForAuth } from "@/lib/db-client";
import type { AutoSendGroup, AutoSendDestination } from "@/lib/auto-send/types";

const ENDPOINT = "/api/db/auto-send-groups";

function dbDelete(key: string, type: "group" | "destination") {
  waitForAuth().then(() => fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key, type }),
  })).catch(() => {});
}

const _cache = createDbCache<AutoSendGroup>();

export function useAutoSendGroups() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);
    return unsub;
  }, []);

  const groups = _cache.get();

  const createGroup = useCallback(
    (entry: { id?: string; name: string; network: string; secretKey: string; intervalMinutes: number | null }) => {
      const id = entry.id ?? crypto.randomUUID();
      const optimistic: AutoSendGroup = {
        id,
        name: entry.name,
        network: entry.network,
        secretKey: entry.secretKey,
        intervalMinutes: entry.intervalMinutes,
        enabled: true,
        batchSend: false,
        batchMemo: undefined,
        minReserve: 10.0,
        minSenderThreshold: 0,
        previewOnly: false,
        createdAt: Date.now(),
        destinations: [],
      };
      _cache.set([optimistic, ..._cache.get()]);
      dbPost(ENDPOINT, { type: "group", id, ...entry }).catch(() => _cache.reload(ENDPOINT));
      // Notify scheduler about new group if it has an interval
      if (entry.intervalMinutes) {
        waitForAuth().then(() => fetch("/api/auto-send/run", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ action: "refresh-scheduler" }),
        })).catch(() => {});
      }
    },
    []
  );

  const updateGroup = useCallback(
    (
      id: string,
      updates: Partial<Pick<AutoSendGroup, "name" | "network" | "secretKey" | "intervalMinutes" | "enabled" | "batchSend" | "batchMemo" | "minReserve" | "minSenderThreshold" | "previewOnly" | "lastFailureAt">>
    ) => {
      _cache.set(_cache.get().map((g) => (g.id === id ? { ...g, ...updates } : g)));
      dbPatch(ENDPOINT, { type: "group", id, ...updates }).catch(() => _cache.reload(ENDPOINT));
      if (updates.enabled !== undefined || updates.intervalMinutes !== undefined) {
        waitForAuth().then(() => fetch("/api/auto-send/run", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ action: "refresh-scheduler" }),
        })).catch(() => {});
      }
    },
    []
  );

  const deleteGroup = useCallback((id: string) => {
    _cache.set(_cache.get().filter((g) => g.id !== id));
    dbDelete(id, "group");
    waitForAuth().then(() => fetch("/api/auto-send/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ action: "refresh-scheduler" }),
    })).catch(() => {});
  }, []);

  const upsertDestination = useCallback(
    (
      groupId: string,
      dest: Omit<AutoSendDestination, "id" | "groupId"> & { id?: string }
    ) => {
      const id = dest.id ?? crypto.randomUUID();
      const full: AutoSendDestination = { ...dest, id, groupId };
      _cache.set(
        _cache.get().map((g) => {
          if (g.id !== groupId) return g;
          const existing = g.destinations.findIndex((d) => d.id === id);
          const destinations =
            existing >= 0
              ? g.destinations.map((d) => (d.id === id ? full : d))
              : [...g.destinations, full];
          return { ...g, destinations };
        })
      );
      dbPost(ENDPOINT, { type: "destination", groupId, ...dest, id }).catch(() => _cache.reload(ENDPOINT));
    },
    []
  );

  const deleteDestination = useCallback((groupId: string, destId: string) => {
    _cache.set(
      _cache.get().map((g) => {
        if (g.id !== groupId) return g;
        return { ...g, destinations: g.destinations.filter((d) => d.id !== destId) };
      })
    );
    dbDelete(destId, "destination");
  }, []);

  return {
    groups,
    isLoaded: _cache.isLoaded(),
    createGroup,
    updateGroup,
    deleteGroup,
    upsertDestination,
    deleteDestination,
  };
}
