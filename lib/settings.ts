import { useCallback, useSyncExternalStore } from "react";
import { Networks } from "stellar-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Network = "public" | "testnet" | "futurenet" | "local";

export interface Settings {
  network: Network;
  /** Only used when network === 'local'. Other networks use HORIZON_URLS. */
  localHorizonUrl: string;
  workerThreads: number;
  notifications: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HORIZON_URLS: Record<Exclude<Network, "local">, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

export const NETWORK_LABELS: Record<Network, string> = {
  public: "Mainnet",
  testnet: "Testnet",
  futurenet: "Futurenet",
  local: "Local (Standalone)",
};

export const NETWORK_PASSPHRASES: Record<Network, string> = {
  public: Networks.PUBLIC,
  testnet: Networks.TESTNET,
  futurenet: Networks.FUTURENET,
  local: Networks.TESTNET,
};

export function resolveNetworkPassphrase(network: Network): string {
  return NETWORK_PASSPHRASES[network];
}

export const DEFAULT_SETTINGS: Settings = {
  network: "public",
  localHorizonUrl: "http://localhost:8000",
  workerThreads: 4,
  notifications: false,
};

const STORAGE_KEY = "stellar-toolkit-settings";
// Custom event name used to notify same-tab subscribers when settings change.
const SETTINGS_EVENT = "stellar-toolkit-settings-changed";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the effective Horizon URL for the given settings. */
export function resolveHorizonUrl(
  settings: Pick<Settings, "network" | "localHorizonUrl">,
): string {
  if (settings.network === "local") return settings.localHorizonUrl;
  return HORIZON_URLS[settings.network];
}

export function loadFromStorage(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveToStorage(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota exceeded or private browsing — silently continue.
  }
}

// ---------------------------------------------------------------------------
// useSyncExternalStore plumbing
//
// React's recommended API for subscribing to external mutable stores.
// Handles SSR (getServerSnapshot), same-tab updates (custom event), and
// cross-tab updates (storage event) without any setState-in-effect pattern.
// ---------------------------------------------------------------------------

// Module-level snapshot cache: prevents useSyncExternalStore from triggering
// an infinite re-render loop when getSnapshot returns a new object reference.
let cachedRaw: string | null | undefined = undefined;
let cachedSnapshot: Settings = DEFAULT_SETTINGS;

function getSnapshot(): Settings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  try {
    cachedSnapshot = raw
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
      : DEFAULT_SETTINGS;
  } catch {
    cachedSnapshot = DEFAULT_SETTINGS;
  }
  return cachedSnapshot;
}

function getServerSnapshot(): Settings {
  return DEFAULT_SETTINGS;
}

function subscribe(callback: () => void): () => void {
  // storage fires for writes from OTHER tabs.
  window.addEventListener("storage", callback);
  // SETTINGS_EVENT fires for writes from THIS tab (dispatched by updateSettings).
  window.addEventListener(SETTINGS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SETTINGS_EVENT, callback);
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSettings() {
  const settings = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    const next = { ...getSnapshot(), ...updates };
    saveToStorage(next);
    // Invalidate the snapshot cache so getSnapshot returns fresh data.
    cachedRaw = undefined;
    // Notify all same-tab subscribers (useSyncExternalStore callbacks).
    window.dispatchEvent(new Event(SETTINGS_EVENT));
  }, []);

  return { settings, updateSettings };
}
