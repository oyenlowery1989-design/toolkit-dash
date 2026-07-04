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
 * Fire-and-forget: run a Supabase write in the background.
 * Never blocks the API response. Errors are logged, not thrown.
 */
export function syncToSupabase(fn: () => PromiseLike<unknown>): void {
  const sb = getSupabase();
  if (!sb) return;
  Promise.resolve(fn()).catch((e) => console.error("[supabase-sync]", e));
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export type AuthResult =
  | { ok: true; userId: string | null } // null = local SQLite mode, no auth required
  | { ok: false; response: NextResponse };

/**
 * Verify the Bearer JWT from the request and return the Supabase user id.
 *
 * In local SQLite mode (isSupabaseOnly() === false): always returns ok with userId = null.
 * In Supabase-only mode: reads Authorization header, verifies with Supabase auth,
 * returns 401 if missing or invalid.
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  if (!isSupabaseOnly()) {
    // Local dev — single user, no auth required
    return { ok: true, userId: null };
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
  const {
    data: { user },
    error,
  } = await sb.auth.getUser(token);

  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, userId: user.id };
}
