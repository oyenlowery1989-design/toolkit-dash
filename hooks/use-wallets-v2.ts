"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, dbDelete, debounce } from "@/lib/db-client";

export interface WalletEntry {
  id: string;
  folderId: string;
  name: string;
  publicKey: string;
  secretKey: string;
  position: number;
}

const ENDPOINT = "/api/db/wallets-v2";
const _cache = createDbCache<WalletEntry>();

// Cross-tab mutation signal: writing this key on every add/remove causes a
// `storage` event to fire in OTHER open tabs (storage events never fire in the
// tab that made the write), which they use to reload the wallets-v2 cache.
// This closes the gap where a background tab kept exposing a wallet's secret
// key after it was deleted elsewhere, with only the (debounced) window-focus
// reload ever catching up.
const WALLETS_TOUCH_KEY = "wallets_v2_updated_at";

function touchWalletsCache() {
  if (typeof window !== "undefined") {
    localStorage.setItem(WALLETS_TOUCH_KEY, String(Date.now()));
  }
}

/** Remove all wallets belonging to a folder from the cache (called by useWalletFolders on delete). */
export function purgeWalletsByFolder(folderId: string) {
  _cache.set(_cache.get().filter((w) => w.folderId !== folderId));
}

/** Force a re-fetch of the wallets-v2 cache (e.g. to restore state after a failed dependent mutation). */
export function reloadWalletsV2() {
  return _cache.reload(ENDPOINT);
}

export function useWalletsV2() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);
    const onFocus = debounce(() => _cache.reload(ENDPOINT), 2000);
    window.addEventListener("focus", onFocus);
    function onStorage(e: StorageEvent) {
      if (e.key === WALLETS_TOUCH_KEY) _cache.reload(ENDPOINT);
    }
    window.addEventListener("storage", onStorage);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const wallets = _cache.get();

  const addWallet = useCallback(
    (folderId: string, name: string, publicKey: string, secretKey: string) => {
      const id = crypto.randomUUID();
      const position = _cache.get().filter((w) => w.folderId === folderId).length;
      const entry: WalletEntry = { id, folderId, name, publicKey, secretKey, position };
      _cache.set([..._cache.get(), entry]);
      touchWalletsCache();
      dbPost(ENDPOINT, entry).catch(() => _cache.reload(ENDPOINT));
      return id;
    },
    []
  );

  const renameWallet = useCallback((id: string, name: string) => {
    _cache.set(_cache.get().map((w) => (w.id === id ? { ...w, name } : w)));
    dbPatch(ENDPOINT, { id, name }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const moveWallet = useCallback((id: string, folderId: string) => {
    _cache.set(_cache.get().map((w) => (w.id === id ? { ...w, folderId } : w)));
    dbPatch(ENDPOINT, { id, folderId }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const removeWallet = useCallback((id: string) => {
    _cache.set(_cache.get().filter((w) => w.id !== id));
    touchWalletsCache();
    dbDelete(ENDPOINT, id).catch(() => _cache.reload(ENDPOINT));
  }, []);

  return { wallets, isLoaded: _cache.isLoaded(), addWallet, renameWallet, moveWallet, removeWallet };
}
