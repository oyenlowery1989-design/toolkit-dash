/**
 * Supabase server-side client for dual-write sync and auth verification.
 *
 * Local dev:  SQLite is primary. Writes also go to Supabase (fire-and-forget backup).
 * Vercel:     No SQLite file on disk → auto-detects and uses Supabase as primary.
 *
 * Env vars required for Supabase:
 *   SUPABASE_URL              — e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (never use anon key server-side)
 *
 * DB_PROVIDER=supabase can also be set explicitly to force Supabase-only mode.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

let _client: SupabaseClient | null = null;

/** Returns the Supabase client, or null if not configured. */
export function getSupabase(): SupabaseClient | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
  }
  return _client;
}

/** True if SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are both set. */
export function isSupabaseConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * True when Supabase should be the only DB (no SQLite).
 * Explicit: DB_PROVIDER=supabase env var.
 * Auto-detect: VERCEL env var is set (always present on Vercel) + Supabase configured.
 *   The .db file may be present in the deployment bundle (tracked in git) but it's
 *   read-only and stale — Supabase is the live source of truth in production.
 */
export function isSupabaseOnly(): boolean {
  if (process.env.DB_PROVIDER === "supabase") return true;
  if (process.env.VERCEL && isSupabaseConfigured()) return true;
  return false;
}

/**
 * Local dual-write mode only: which Supabase user id background sync writes
 * should be attributed to. Every row synced to Supabase requires a non-null
 * user_id (NOT NULL + RLS), so this must resolve to a real id before any
 * write is attempted — never fall back to writing user_id: null.
 */
export function resolveLocalSyncUserId(): string | null {
  return process.env.SUPABASE_SYNC_USER_ID ?? null;
}

let _syncSkipWarned = false;

/** Warns once per process boot that local→Supabase sync is disabled. */
export function warnSyncSkippedOnce(): void {
  if (_syncSkipWarned) return;
  _syncSkipWarned = true;
  console.warn(
    "[supabase-sync] skipped: set SUPABASE_SYNC_USER_ID to enable local→Supabase backup",
  );
}

/**
 * Fire-and-forget: run a Supabase write in the background.
 * Never blocks the API response. Errors are logged, not thrown.
 *
 * In local dual-write mode (isSupabaseOnly() === false), the sync is skipped
 * entirely — with a once-per-boot warning — unless SUPABASE_SYNC_USER_ID is
 * set. This is the single place that gates local→Supabase writes so no
 * caller can accidentally push a user_id: null row.
 */
export function syncToSupabase(fn: () => PromiseLike<unknown>): void {
  const sb = getSupabase();
  if (!sb) return;
  if (!isSupabaseOnly() && !resolveLocalSyncUserId()) {
    warnSyncSkippedOnce();
    return;
  }
  Promise.resolve(fn()).catch((e) => console.error("[supabase-sync]", e));
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export type AuthResult =
  | { ok: true; userId: string | null } // local SQLite mode: SUPABASE_SYNC_USER_ID or null (sync skipped); cloud mode: always non-null
  | { ok: false; response: NextResponse };

/**
 * Verify the Bearer JWT from the request and return the Supabase user id.
 *
 * In local SQLite mode (isSupabaseOnly() === false): always returns ok. userId is
 * resolved from SUPABASE_SYNC_USER_ID (used only to attribute optional local→Supabase
 * backup writes) — null if that env var isn't set, in which case sync is skipped
 * (see syncToSupabase). No auth is required to use the app locally either way.
 * In Supabase-only mode: reads Authorization header, verifies with Supabase auth,
 * returns 401 if missing or invalid.
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  if (!isSupabaseOnly()) {
    // Local dev — single user, no auth required
    return { ok: true, userId: resolveLocalSyncUserId() };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const token = authHeader.slice(7);
  const sb = getSupabase()!;

  let user: { id: string } | null = null;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
    user = data.user;
  } catch (e) {
    // Network/timeout reaching Supabase Auth itself — distinct from an
    // invalid/expired token, so callers can tell "retry" from "log in again".
    console.error("[auth] Supabase getUser request failed:", e);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Auth service unavailable — please retry" },
        { status: 503 },
      ),
    };
  }

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, userId: user.id };
}
