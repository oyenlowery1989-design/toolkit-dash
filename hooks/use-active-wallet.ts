"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWalletsV2 } from "./use-wallets-v2";

const LS_KEY = "active_wallet_id";
const STATE_ENDPOINT = "/api/db/app-state";

// Module-level so all hook instances share the same active wallet state
let _activeId: string | null = null;
const _listeners = new Set<() => void>();
let _dbLoaded = false;

function notifyAll() {
  _listeners.forEach((fn) => fn());
}

export function setActiveWalletId(id: string | null) {
  _activeId = id;
  if (typeof window !== "undefined") {
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  }
  // Persist to DB (fire and forget); empty string = clear
  fetch(STATE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: LS_KEY, value: id ?? "" }),
  }).catch(() => {});
  notifyAll();
}

export function useActiveWallet() {
  const [, rerender] = useState(0);
  const { wallets } = useWalletsV2();
  // Use a ref+counter pattern to prevent multiple self-heal timers stacking up
  const selfHealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selfHealedRef = useRef(false);

  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    _listeners.add(fn);

    // On first mount: read localStorage first (instant), then reconcile with DB
    if (_activeId === null && typeof window !== "undefined") {
      const lsId = localStorage.getItem(LS_KEY);
      if (lsId) {
        _activeId = lsId;
        notifyAll();
      }
    }

    // Reconcile with DB (handles case where localStorage was cleared)
    if (!_dbLoaded) {
      fetch(STATE_ENDPOINT)
        .then((r) => r.json())
        .then((state: Record<string, string>) => {
          _dbLoaded = true;
          const dbId = state[LS_KEY] ?? null;
          if (dbId && dbId !== _activeId) {
            _activeId = dbId;
            if (typeof window !== "undefined") localStorage.setItem(LS_KEY, dbId);
            notifyAll();
          }
        })
        .catch(() => { _dbLoaded = true; });
    }

    // Cross-tab sync: if another tab connects/disconnects, pick it up
    function onStorage(e: StorageEvent) {
      if (e.key !== LS_KEY) return;
      const newId = e.newValue ?? null;
      if (newId !== _activeId) {
        _activeId = newId;
        notifyAll();
      }
    }
    window.addEventListener("storage", onStorage);

    return () => {
      _listeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const activeWallet = wallets.find((w) => w.id === _activeId) ?? null;

  // Self-heal: if stored ID points to a deleted wallet, clear it.
  // Use a ref-based timer to prevent stacking multiple timers on rapid re-renders.
  useEffect(() => {
    if (_activeId === null || activeWallet !== null || selfHealedRef.current) return;
    // Wallet list may still be loading — only heal once wallets have loaded
    if (wallets.length === 0) return;

    if (selfHealTimerRef.current) clearTimeout(selfHealTimerRef.current);
    selfHealTimerRef.current = setTimeout(() => {
      selfHealTimerRef.current = null;
      if (_activeId !== null && !wallets.find((w) => w.id === _activeId)) {
        selfHealedRef.current = true;
        setActiveWalletId(null);
      }
    }, 150);

    return () => {
      if (selfHealTimerRef.current) {
        clearTimeout(selfHealTimerRef.current);
        selfHealTimerRef.current = null;
      }
    };
  }, [wallets, activeWallet]);

  const connect = useCallback((id: string) => setActiveWalletId(id), []);
  const disconnect = useCallback(() => setActiveWalletId(null), []);

  return { activeWallet, activeId: _activeId, connect, disconnect };
}
