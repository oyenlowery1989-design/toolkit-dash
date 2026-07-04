/**
 * Shared helpers for DB-backed hooks.
 * Each hook gets its own module-level cache so all hook instances
 * share a single fetch and notify each other on writes.
 */

// ── Auth token ────────────────────────────────────────────────────────────────
// Set by AuthInit when the user's Supabase session loads.
// Sent as Authorization: Bearer on every API call so server routes can verify identity.

let _authToken: string | null = null;

// Resolves once setDbAuthToken is called for the first time (auth initialised).
// In local dev (no NEXT_PUBLIC_SUPABASE_URL) we resolve immediately on first call.
let _authReady = false;
let _authReadyResolve: (() => void) | null = null;
const _authReadyPromise: Promise<void> = new Promise((resolve) => {
  _authReadyResolve = resolve;
});

// Registry of all active caches — populated by createDbCache, used by clearAllCaches.
const _allCaches = new Set<{ invalidate(): void }>();

export function setDbAuthToken(token: string | null): void {
  _authToken = token;
  if (!_authReady) {
    _authReady = true;
    _authReadyResolve?.();
  }
}

/**
 * Clears all module-level DB caches so they re-fetch on next access.
 * Call on sign-out to prevent stale data leaking to the next user session.
 */
export function clearAllCaches(): void {
  _allCaches.forEach((c) => c.invalidate());
}

/**
 * Waits until auth has been initialised (or immediately if auth is not
 * configured). Call this before any fetch that requires a bearer token.
 */
export function waitForAuth(): Promise<void> {
  // If no Supabase URL is configured we're in local mode — no wait needed.
  if (typeof window !== "undefined" && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return Promise.resolve();
  }
  return _authReadyPromise;
}

export function authHeaders(): Record<string, string> {
  if (!_authToken) return {};
  return { Authorization: `Bearer ${_authToken}` };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

export interface DbCache<T> {
  get(): T[];
  set(data: T[]): void;
  notify(): void;
  isLoaded(): boolean;
  subscribe(fn: () => void): () => void;
  load(endpoint: string): Promise<void>;
  /** Force re-fetch from server regardless of cache state */
  reload(endpoint: string): Promise<void>;
  /** Clear cached data and notify subscribers (used by clearAllCaches on sign-out) */
  invalidate(): void;
}

export function createDbCache<T>(): DbCache<T> {
  let cache: T[] | null = null;
  let loading = false;
  let fetchPromise: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const instance = {
    get() {
      return cache ?? [];
    },
    set(data: T[]) {
      cache = data;
      listeners.forEach((fn) => fn());
    },
    notify() {
      listeners.forEach((fn) => fn());
    },
    isLoaded() {
      return cache !== null;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async load(endpoint: string) {
      if (cache !== null || loading) return fetchPromise ?? Promise.resolve();
      // Listen for stellardb:sync — re-fetch if Supabase pushed new data on startup
      if (typeof window !== "undefined") {
        window.addEventListener("stellardb:sync", () => instance.reload(endpoint), { once: true });
      }
      loading = true;
      fetchPromise = waitForAuth().then(() => fetch(endpoint, { headers: authHeaders() }))
        .then((r) => (r.ok ? r.json() : []))
        .then((data: T[]) => {
          cache = data;
          listeners.forEach((fn) => fn());
        })
        .catch(() => {
          cache = [];
          listeners.forEach((fn) => fn());
        })
        .finally(() => {
          loading = false;
        });
      return fetchPromise;
    },
    async reload(endpoint: string) {
      if (loading) return fetchPromise ?? Promise.resolve();
      loading = true;
      cache = null;
      fetchPromise = waitForAuth().then(() => fetch(endpoint, { headers: authHeaders() }))
        .then((r) => (r.ok ? r.json() : []))
        .then((data: T[]) => {
          cache = data;
          listeners.forEach((fn) => fn());
        })
        .catch(() => {
          cache = [];
          listeners.forEach((fn) => fn());
        })
        .finally(() => {
          loading = false;
        });
      return fetchPromise;
    },
    invalidate() {
      cache = null;
      loading = false;
      fetchPromise = null;
      listeners.forEach((fn) => fn());
    },
  };

  _allCaches.add(instance);
  return instance;
}

/** Returns a debounced version of fn that delays invocation by `ms` milliseconds. */
export function debounce<T extends () => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  } as T;
}

export async function dbPost(endpoint: string, data: unknown): Promise<void> {
  await waitForAuth();
  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  })
    .then((r) => { if (!r.ok) console.error(`[db] POST ${endpoint} failed: ${r.status}`); })
    .catch((e) => console.error(`[db] POST ${endpoint} network error:`, e));
}

export async function dbPatch(endpoint: string, data: unknown): Promise<void> {
  await waitForAuth();
  await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  })
    .then((r) => { if (!r.ok) console.error(`[db] PATCH ${endpoint} failed: ${r.status}`); })
    .catch((e) => console.error(`[db] PATCH ${endpoint} network error:`, e));
}

export async function dbDelete(endpoint: string, key: unknown): Promise<void> {
  await waitForAuth();
  await fetch(endpoint, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key }),
  })
    .then((r) => { if (!r.ok) console.error(`[db] DELETE ${endpoint} failed: ${r.status}`); })
    .catch((e) => console.error(`[db] DELETE ${endpoint} network error:`, e));
}
