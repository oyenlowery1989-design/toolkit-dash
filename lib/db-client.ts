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
  /** Last load/reload error message, or null if the last attempt succeeded (or none has failed yet). */
  error(): string | null;
  subscribe(fn: () => void): () => void;
  load(endpoint: string): Promise<void>;
  /** Force re-fetch from server regardless of cache state */
  reload(endpoint: string): Promise<void>;
  /** Clear cached data and notify subscribers (used by clearAllCaches on sign-out) */
  invalidate(): void;
}

const RETRY_DELAY_MS = 3000;

export function createDbCache<T>(): DbCache<T> {
  let cache: T[] | null = null;
  let loading = false;
  let error: string | null = null;
  let fetchPromise: Promise<void> | null = null;
  let retryScheduled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let syncListenerAdded = false;
  const listeners = new Set<() => void>();

  // Runs the actual GET + updates cache/error state. On failure the cache is left
  // untouched (stays null until a successful load, so isLoaded() stays false) and
  // a single retry is scheduled 3s out so we never stack up retry storms.
  function doFetch(endpoint: string): Promise<void> {
    loading = true;
    const p = waitForAuth()
      .then(() => fetch(endpoint, { headers: authHeaders() }))
      .then((r) => {
        if (!r.ok) throw new Error(`GET ${endpoint} failed: ${r.status}`);
        return r.json() as Promise<T[]>;
      })
      .then((data: T[]) => {
        cache = data;
        error = null;
        // A success landing while a retry is pending means the retry is now
        // stale/redundant — cancel it (belt-and-braces alongside invalidate()).
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        retryScheduled = false;
        listeners.forEach((fn) => fn());
      })
      .catch((e) => {
        console.error(`[db] GET ${endpoint} failed:`, e);
        error = e instanceof Error ? e.message : String(e);
        listeners.forEach((fn) => fn());
        if (!retryScheduled) {
          retryScheduled = true;
          retryTimer = setTimeout(() => {
            retryScheduled = false;
            retryTimer = null;
            instance.reload(endpoint);
          }, RETRY_DELAY_MS);
        }
      })
      .finally(() => {
        loading = false;
      });
    fetchPromise = p;
    return p;
  }

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
    error() {
      return error;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async load(endpoint: string) {
      if (cache !== null || loading) return fetchPromise ?? Promise.resolve();
      // Listen for stellardb:sync — re-fetch if Supabase pushed new data on startup.
      // Registered once per cache instance (not per load call) so invalidate()/reload()
      // cycles never accumulate duplicate listeners.
      if (!syncListenerAdded && typeof window !== "undefined") {
        syncListenerAdded = true;
        window.addEventListener("stellardb:sync", () => instance.reload(endpoint));
      }
      return doFetch(endpoint);
    },
    async reload(endpoint: string) {
      if (loading) {
        // Chain a fresh fetch after the in-flight one completes instead of
        // returning the stale promise — callers of reload() expect a fetch
        // that starts (or continues) after this call, not a no-op.
        return fetchPromise!.then(() => doFetch(endpoint));
      }
      // Stale-while-revalidate: keep showing current data until the fresh GET
      // lands. Nulling here blanks every consumer (list → empty/spinner) and a
      // single failed fetch leaves the UI empty until a retry succeeds.
      return doFetch(endpoint);
    },
    invalidate() {
      cache = null;
      loading = false;
      fetchPromise = null;
      error = null;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      retryScheduled = false;
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

export async function dbPost(endpoint: string, data: unknown): Promise<unknown> {
  await waitForAuth();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error(`[db] POST ${endpoint} network error:`, e);
    throw e;
  }
  if (!res.ok) {
    console.error(`[db] POST ${endpoint} failed: ${res.status}`);
    const body = await res.json().catch(() => undefined);
    const err = new Error(`POST ${endpoint} failed: ${res.status}`) as Error & { body?: unknown };
    err.body = body;
    throw err;
  }
  return res.json().catch(() => undefined);
}

export async function dbPatch(endpoint: string, data: unknown): Promise<void> {
  await waitForAuth();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error(`[db] PATCH ${endpoint} network error:`, e);
    throw e;
  }
  if (!res.ok) {
    console.error(`[db] PATCH ${endpoint} failed: ${res.status}`);
    throw new Error(`PATCH ${endpoint} failed: ${res.status}`);
  }
}

export async function dbDelete(endpoint: string, key: unknown): Promise<void> {
  await waitForAuth();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ key }),
    });
  } catch (e) {
    console.error(`[db] DELETE ${endpoint} network error:`, e);
    throw e;
  }
  if (!res.ok) {
    console.error(`[db] DELETE ${endpoint} failed: ${res.status}`);
    throw new Error(`DELETE ${endpoint} failed: ${res.status}`);
  }
}
