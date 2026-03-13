"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch } from "@/lib/db-client";

function dbDeleteGroup(id: string) {
  fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: id, type: "group" }),
  }).catch(() => {});
}
function dbDeleteMember(id: string) {
  fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: id, type: "member" }),
  }).catch(() => {});
}
import type {
  AssetGroup,
  GroupMember,
  GroupMemberRole,
} from "@/lib/asset-groups/types";

const ENDPOINT = "/api/db/groups";
const _cache = createDbCache<AssetGroup>();

export function getAssetGroupsSnapshot(): AssetGroup[] {
  return _cache.get();
}

export function isAssetGroupsLoaded(): boolean {
  return _cache.isLoaded();
}

export function useAssetGroups() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);

    // Re-sync when user returns to this tab (e.g. after saving a group in a new tab)
    const onFocus = () => _cache.reload(ENDPOINT);
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const groups = _cache.get();

  const createGroup = useCallback(
    (entry: {
      name: string;
      assetCode?: string;
      issuer?: string;
      network: string;
      notes?: string;
    }): string => {
      const nameTrimmed = entry.name.trim();
      const assetCodeNorm = entry.assetCode?.trim()
        ? entry.assetCode.trim().toUpperCase()
        : undefined;
      const issuerNorm = entry.issuer?.trim() ? entry.issuer.trim() : undefined;
      const networkNorm = entry.network?.trim() || "public";

      if (assetCodeNorm && issuerNorm) {
        const existing = _cache
          .get()
          .find(
            (g) =>
              g.assetCode?.trim().toUpperCase() === assetCodeNorm &&
              g.issuer?.trim() === issuerNorm &&
              (g.network?.trim() || "public") === networkNorm,
          );
        if (existing) return existing.id;
      }

      const id = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const normalizedEntry = {
        ...entry,
        name: nameTrimmed,
        assetCode: assetCodeNorm,
        issuer: issuerNorm,
        network: networkNorm,
      };
      const newGroup: AssetGroup = {
        ...normalizedEntry,
        id,
        members: [],
        createdAt: now,
        updatedAt: now,
      };
      _cache.set([newGroup, ..._cache.get()]);
      dbPost(ENDPOINT, { type: "group", id, ...normalizedEntry });
      return id;
    },
    [],
  );

  const updateGroup = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<AssetGroup, "name" | "notes" | "assetCode" | "issuer" | "network">
      >,
    ) => {
      _cache.set(
        _cache
          .get()
          .map((g) =>
            g.id === id ? { ...g, ...patch, updatedAt: Date.now() } : g,
          ),
      );
      dbPatch(ENDPOINT, { type: "group", id, ...patch });
    },
    [],
  );

  const deleteGroup = useCallback((id: string) => {
    _cache.set(_cache.get().filter((g) => g.id !== id));
    dbDeleteGroup(id);
  }, []);

  const upsertMember = useCallback(
    (
      groupId: string,
      member: Omit<GroupMember, "id" | "groupId" | "addedAt">,
    ) => {
      const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const newMember: GroupMember = { ...member, id, groupId, addedAt: now };
      _cache.set(
        _cache.get().map((g) => {
          if (g.id !== groupId) return g;
          const existing = g.members.findIndex(
            (m) => m.address === member.address,
          );
          const members =
            existing >= 0
              ? g.members.map((m, i) =>
                  i === existing ? { ...m, ...member } : m,
                )
              : [...g.members, newMember];
          return { ...g, members, updatedAt: now };
        }),
      );
      dbPost(ENDPOINT, { type: "member", id, groupId, ...member });
    },
    [],
  );

  const updateMember = useCallback(
    (
      groupId: string,
      memberId: string,
      patch: Partial<
        Pick<GroupMember, "label" | "notes" | "role" | "homeDomain">
      >,
    ) => {
      _cache.set(
        _cache.get().map((g) =>
          g.id !== groupId
            ? g
            : {
                ...g,
                updatedAt: Date.now(),
                members: g.members.map((m) =>
                  m.id === memberId ? { ...m, ...patch } : m,
                ),
              },
        ),
      );
      dbPatch(ENDPOINT, { type: "member", id: memberId, groupId, ...patch });
    },
    [],
  );

  const removeMember = useCallback((groupId: string, memberId: string) => {
    _cache.set(
      _cache
        .get()
        .map((g) =>
          g.id !== groupId
            ? g
            : { ...g, members: g.members.filter((m) => m.id !== memberId) },
        ),
    );
    dbDeleteMember(memberId);
  }, []);

  return {
    groups,
    isLoaded: _cache.isLoaded(),
    createGroup,
    updateGroup,
    deleteGroup,
    upsertMember,
    updateMember,
    removeMember,
  };
}
