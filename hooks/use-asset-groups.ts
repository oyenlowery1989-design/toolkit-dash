"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, authHeaders, debounce } from "@/lib/db-client";
import type {
  AssetGroup,
  GroupMember,
  GroupMemberRole,
} from "@/lib/asset-groups/types";

const ENDPOINT = "/api/db/groups";

function dbDeleteGroup(id: string) {
  fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key: id, type: "group" }),
  }).catch(() => {});
}
function dbDeleteMember(id: string) {
  fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key: id, type: "member" }),
  }).catch(() => {});
}
const _cache = createDbCache<AssetGroup>();

// Client group id -> promise resolving to the canonical server id.
// Populated by createGroup, consumed by upsertMember/updateGroup/deleteGroup
// so writes that race the group-create dedupe response target the right id.
const _pendingGroupCreates = new Map<string, Promise<string>>();

/**
 * Rewrites a group's id (and all its members' groupId) from oldId to newId
 * in the cache. If a group with newId already exists, merges oldId's members
 * into it (skipping members whose address is already present) and drops the
 * oldId entry. Always notifies subscribers.
 */
function remapGroupId(oldId: string, newId: string): void {
  if (oldId === newId) return;
  const groups = _cache.get();
  const oldGroup = groups.find((g) => g.id === oldId);
  if (!oldGroup) return;
  const newGroup = groups.find((g) => g.id === newId);

  if (newGroup) {
    const mergedMembers = [...newGroup.members];
    for (const m of oldGroup.members) {
      if (!mergedMembers.some((existing) => existing.address === m.address)) {
        mergedMembers.push({ ...m, groupId: newId });
      }
    }
    _cache.set(
      groups
        .filter((g) => g.id !== oldId)
        .map((g) =>
          g.id === newId ? { ...g, members: mergedMembers } : g,
        ),
    );
  } else {
    _cache.set(
      groups.map((g) =>
        g.id !== oldId
          ? g
          : {
              ...g,
              id: newId,
              members: g.members.map((m) => ({ ...m, groupId: newId })),
            },
      ),
    );
  }
}

export function getAssetGroupsSnapshot(): AssetGroup[] {
  return _cache.get();
}

export function isAssetGroupsLoaded(): boolean {
  return _cache.isLoaded();
}

/** Resolves to the canonical server id for a group that may still be mid-create. */
export function waitForGroupId(clientId: string): Promise<string> {
  return _pendingGroupCreates.get(clientId) ?? Promise.resolve(clientId);
}

export function useAssetGroups() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);

    // Re-sync when user returns to this tab (e.g. after saving a group in a new tab)
    const onFocus = debounce(() => _cache.reload(ENDPOINT), 2000);
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
        assetCode: entry.assetCode?.trim() || undefined,
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
      const p = dbPost(ENDPOINT, { type: "group", id, ...normalizedEntry })
        .then((res: any) => {
          const serverId = res?.reused && res?.existingId ? String(res.existingId) : id;
          if (serverId !== id) remapGroupId(id, serverId);
          return serverId;
        })
        .catch((err: any) => {
          const existingId = err?.body?.existingId;
          if (existingId) {
            remapGroupId(id, String(existingId));
            return String(existingId);
          }
          _cache.reload(ENDPOINT);
          return id;
        });
      _pendingGroupCreates.set(id, p);
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
      const pending = _pendingGroupCreates.get(id) ?? Promise.resolve(id);
      pending
        .then((realId) => {
          if (realId !== id) {
            _cache.set(
              _cache
                .get()
                .map((g) =>
                  g.id === realId ? { ...g, ...patch, updatedAt: Date.now() } : g,
                ),
            );
          }
          return dbPatch(ENDPOINT, { type: "group", id: realId, ...patch });
        })
        .catch(() => _cache.reload(ENDPOINT));
    },
    [],
  );

  const deleteGroup = useCallback((id: string) => {
    _cache.set(_cache.get().filter((g) => g.id !== id));
    const pending = _pendingGroupCreates.get(id) ?? Promise.resolve(id);
    pending.then((realId) => dbDeleteGroup(realId));
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
      const pending = _pendingGroupCreates.get(groupId) ?? Promise.resolve(groupId);
      pending
        .then((realGroupId) =>
          dbPost(ENDPOINT, { type: "member", id, groupId: realGroupId, ...member }),
        )
        .catch(() => _cache.reload(ENDPOINT));
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
      const pending = _pendingGroupCreates.get(groupId) ?? Promise.resolve(groupId);
      pending
        .then((realGroupId) =>
          dbPatch(ENDPOINT, { type: "member", id: memberId, groupId: realGroupId, ...patch }),
        )
        .catch(() => _cache.reload(ENDPOINT));
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
    waitForGroupId,
  };
}
