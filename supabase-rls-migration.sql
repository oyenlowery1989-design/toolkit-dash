-- Fix: sensitive_columns_exposed + rls_disabled_in_public (Supabase Security Advisor)
--
-- Root cause: no table in this schema had RLS enabled. The app's own API routes use
-- SUPABASE_SERVICE_ROLE_KEY (bypasses RLS by design, unaffected by this migration),
-- but the browser also holds a public NEXT_PUBLIC_SUPABASE_ANON_KEY for login
-- (see lib/supabase-client.ts). With RLS off, that key lets anyone with the project
-- URL hit PostgREST directly (e.g. GET /rest/v1/wallets) and read/write/delete every
-- user's rows — including plaintext secret_key columns in wallets and
-- tiered_reward_configs.
--
-- Fix: enable RLS on every table, add one owner-scoped policy per table for the
-- `authenticated` role keyed on auth.uid()::text = user_id (user_id already IS the
-- Supabase Auth user id — see requireAuth() in lib/supabase-server.ts). No policy is
-- added for `anon` — the browser client is auth-only and never queries tables
-- directly, so anon should stay fully denied once RLS is on.
--
-- Child tables (no user_id column) are scoped through their parent FK.
--
-- Safe to run multiple times (DROP POLICY IF EXISTS guards).

-- ── auto_send_* tables ──────────────────────────────────────────────────────
-- Live in Supabase (used by app/api/db/auto-send-groups/route.ts) but were never
-- added to this tracked schema file — adding IF NOT EXISTS so this migration is
-- also the fix for that drift, matching lib/db.ts's SQLite definitions.
CREATE TABLE IF NOT EXISTS auto_send_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  network TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  interval_minutes INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT false,
  batch_send BOOLEAN NOT NULL DEFAULT true,
  batch_memo TEXT,
  min_reserve DOUBLE PRECISION NOT NULL DEFAULT 10.0,
  min_sender_threshold DOUBLE PRECISION NOT NULL DEFAULT 0,
  preview_only BOOLEAN NOT NULL DEFAULT false,
  last_failure_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auto_send_groups_user ON auto_send_groups(user_id);

CREATE TABLE IF NOT EXISTS auto_send_destinations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES auto_send_groups(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  percentage DOUBLE PRECISION,
  is_remainder BOOLEAN NOT NULL DEFAULT false,
  is_paused BOOLEAN NOT NULL DEFAULT false,
  label TEXT,
  memo TEXT,
  min_threshold DOUBLE PRECISION,
  max_cap DOUBLE PRECISION,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_auto_send_destinations_group ON auto_send_destinations(group_id);

CREATE TABLE IF NOT EXISTS auto_send_run_log (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  destination TEXT NOT NULL,
  amount_sent DOUBLE PRECISION,
  status TEXT NOT NULL,
  error TEXT,
  ran_at BIGINT NOT NULL,
  tx_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_auto_send_run_log_group ON auto_send_run_log(group_id, ran_at DESC);

-- ── Enable RLS everywhere ────────────────────────────────────────────────────
ALTER TABLE address_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_intermediaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE proceeds_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_run_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_scan_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiered_reward_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiered_reward_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiered_reward_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiered_reward_run_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_send_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_send_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_send_run_log ENABLE ROW LEVEL SECURITY;

-- ── Owner-scoped policies: tables with a direct user_id column ──────────────
DROP POLICY IF EXISTS owner_all ON address_book;
CREATE POLICY owner_all ON address_book FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON known_intermediaries;
CREATE POLICY owner_all ON known_intermediaries FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON known_creators;
CREATE POLICY owner_all ON known_creators FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON saved_analyses;
CREATE POLICY owner_all ON saved_analyses FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON bulk_recipients;
CREATE POLICY owner_all ON bulk_recipients FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON proceeds_presets;
CREATE POLICY owner_all ON proceeds_presets FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON saved_searches;
CREATE POLICY owner_all ON saved_searches FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON bulk_run_history;
CREATE POLICY owner_all ON bulk_run_history FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON asset_groups;
CREATE POLICY owner_all ON asset_groups FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON wallet_folders;
CREATE POLICY owner_all ON wallet_folders FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON wallets;
CREATE POLICY owner_all ON wallets FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON app_state;
CREATE POLICY owner_all ON app_state FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON bulk_scan_state;
CREATE POLICY owner_all ON bulk_scan_state FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON creator_children;
CREATE POLICY owner_all ON creator_children FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON tiered_reward_configs;
CREATE POLICY owner_all ON tiered_reward_configs FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON tiered_reward_run_log;
CREATE POLICY owner_all ON tiered_reward_run_log FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS owner_all ON auto_send_groups;
CREATE POLICY owner_all ON auto_send_groups FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- ── Child tables: scoped through parent FK ───────────────────────────────────
DROP POLICY IF EXISTS owner_all ON asset_group_members;
CREATE POLICY owner_all ON asset_group_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM asset_groups g WHERE g.id = group_id AND auth.uid()::text = g.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM asset_groups g WHERE g.id = group_id AND auth.uid()::text = g.user_id));

DROP POLICY IF EXISTS owner_all ON tiered_reward_tiers;
CREATE POLICY owner_all ON tiered_reward_tiers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM tiered_reward_configs c WHERE c.id = config_id AND auth.uid()::text = c.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tiered_reward_configs c WHERE c.id = config_id AND auth.uid()::text = c.user_id));

DROP POLICY IF EXISTS owner_all ON tiered_reward_assets;
CREATE POLICY owner_all ON tiered_reward_assets FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tiered_reward_tiers t
    JOIN tiered_reward_configs c ON c.id = t.config_id
    WHERE t.id = tier_id AND auth.uid()::text = c.user_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tiered_reward_tiers t
    JOIN tiered_reward_configs c ON c.id = t.config_id
    WHERE t.id = tier_id AND auth.uid()::text = c.user_id
  ));

DROP POLICY IF EXISTS owner_all ON auto_send_destinations;
CREATE POLICY owner_all ON auto_send_destinations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM auto_send_groups g WHERE g.id = group_id AND auth.uid()::text = g.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM auto_send_groups g WHERE g.id = group_id AND auth.uid()::text = g.user_id));

DROP POLICY IF EXISTS owner_all ON auto_send_run_log;
CREATE POLICY owner_all ON auto_send_run_log FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM auto_send_groups g WHERE g.id = group_id AND auth.uid()::text = g.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM auto_send_groups g WHERE g.id = group_id AND auth.uid()::text = g.user_id));
