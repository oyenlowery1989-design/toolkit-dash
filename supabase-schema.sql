-- Stellar Toolkit Supabase Schema (multi-user)
CREATE TABLE IF NOT EXISTS address_book (user_id TEXT NOT NULL DEFAULT '', public_key TEXT NOT NULL, label TEXT NOT NULL, notes TEXT, color TEXT, created_at BIGINT NOT NULL, PRIMARY KEY (user_id, public_key));
CREATE TABLE IF NOT EXISTS known_intermediaries (user_id TEXT NOT NULL DEFAULT '', address TEXT NOT NULL, name TEXT NOT NULL, notes TEXT, added_at BIGINT NOT NULL, PRIMARY KEY (user_id, address));
CREATE TABLE IF NOT EXISTS known_creators (user_id TEXT NOT NULL DEFAULT '', address TEXT NOT NULL, name TEXT NOT NULL, notes TEXT, added_at BIGINT NOT NULL, parent_address TEXT, PRIMARY KEY (user_id, address));
CREATE TABLE IF NOT EXISTS saved_analyses (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, asset_code TEXT NOT NULL, issuer TEXT NOT NULL, distrib_addresses JSONB NOT NULL DEFAULT '[]', network TEXT NOT NULL, result_json JSONB NOT NULL, notes TEXT, tags JSONB, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_saved_analyses_user ON saved_analyses(user_id);
CREATE TABLE IF NOT EXISTS bulk_recipients (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, network TEXT NOT NULL, addresses JSONB NOT NULL DEFAULT '[]', assets_text TEXT, saved_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bulk_recipients_user ON bulk_recipients(user_id);
CREATE TABLE IF NOT EXISTS proceeds_presets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', asset_code TEXT NOT NULL, issuer TEXT NOT NULL, distribution_address TEXT NOT NULL, network TEXT NOT NULL, accounts_text TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_proceeds_presets_user ON proceeds_presets(user_id);
CREATE TABLE IF NOT EXISTS saved_searches (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', type TEXT NOT NULL, value TEXT NOT NULL, label TEXT, network TEXT, distrib_address TEXT, total_xlm_proceeds DOUBLE PRECISION, total_asset_sold DOUBLE PRECISION, intermediary_name TEXT, accounts_found INTEGER, created_at BIGINT NOT NULL, UNIQUE(user_id, type, value));
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);
CREATE TABLE IF NOT EXISTS bulk_run_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', network TEXT NOT NULL, memo TEXT NOT NULL, recipient_count INTEGER NOT NULL, success_count INTEGER NOT NULL, failed_count INTEGER NOT NULL, ran_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bulk_run_history_user ON bulk_run_history(user_id);
CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, role TEXT, notes TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_persons_user ON persons(user_id);
CREATE TABLE IF NOT EXISTS person_addresses (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE, address TEXT NOT NULL, label TEXT, added_at BIGINT NOT NULL, UNIQUE(person_id, address));
CREATE INDEX IF NOT EXISTS idx_person_addresses_person ON person_addresses(person_id);
CREATE INDEX IF NOT EXISTS idx_person_addresses_address ON person_addresses(address);
CREATE TABLE IF NOT EXISTS asset_groups (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, asset_code TEXT, issuer TEXT, network TEXT NOT NULL DEFAULT 'public', notes TEXT, domain TEXT, telegram_channel TEXT, telegram_link TEXT, person_id TEXT REFERENCES persons(id) ON DELETE SET NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_groups_identity ON asset_groups(user_id, asset_code, issuer, network) WHERE asset_code IS NOT NULL AND issuer IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asset_groups_user ON asset_groups(user_id);
CREATE TABLE IF NOT EXISTS asset_group_members (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES asset_groups(id) ON DELETE CASCADE, address TEXT NOT NULL, role TEXT NOT NULL, label TEXT, notes TEXT, home_domain TEXT, added_at BIGINT NOT NULL, UNIQUE(group_id, address));
CREATE INDEX IF NOT EXISTS idx_group_members_group ON asset_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_address ON asset_group_members(address);
CREATE TABLE IF NOT EXISTS wallet_folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_wallet_folders_user ON wallet_folders(user_id);
CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', folder_id TEXT REFERENCES wallet_folders(id) ON DELETE CASCADE, name TEXT NOT NULL, public_key TEXT NOT NULL, secret_key TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_wallets_folder ON wallets(folder_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
CREATE TABLE IF NOT EXISTS app_state (user_id TEXT NOT NULL DEFAULT '', key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS bulk_scan_state (user_id TEXT PRIMARY KEY, rows_json TEXT NOT NULL, interrupted BOOLEAN NOT NULL DEFAULT false, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS creator_children (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', creator_address TEXT NOT NULL, child_address TEXT NOT NULL, network TEXT NOT NULL DEFAULT 'public', via_intermediary TEXT, created_on_chain TEXT, confidence INTEGER, starting_balance DOUBLE PRECISION, home_domain TEXT, issued_assets JSONB, distributed_assets JSONB, parent_address TEXT, discovered_at BIGINT NOT NULL, UNIQUE(user_id, creator_address, child_address, network));
CREATE INDEX IF NOT EXISTS idx_creator_children_user ON creator_children(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_children_creator ON creator_children(creator_address, network);
CREATE INDEX IF NOT EXISTS idx_creator_children_child ON creator_children(child_address);

-- Tiered Rewards (multi-user)
CREATE TABLE IF NOT EXISTS tiered_reward_configs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, asset_code TEXT NOT NULL, asset_issuer TEXT NOT NULL, network TEXT NOT NULL DEFAULT 'public', secret_key TEXT NOT NULL DEFAULT '', interval_minutes INTEGER, enabled BOOLEAN NOT NULL DEFAULT false, min_reserve DOUBLE PRECISION NOT NULL DEFAULT 10.0, min_sender_threshold DOUBLE PRECISION NOT NULL DEFAULT 0, preview_only BOOLEAN NOT NULL DEFAULT false, batch_send BOOLEAN NOT NULL DEFAULT true, memo TEXT, fee_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0, exclude_addresses JSONB NOT NULL DEFAULT '[]', last_run_at BIGINT, last_failure_at BIGINT, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tiered_reward_configs_user ON tiered_reward_configs(user_id);
CREATE TABLE IF NOT EXISTS tiered_reward_tiers (id TEXT PRIMARY KEY, config_id TEXT NOT NULL REFERENCES tiered_reward_configs(id) ON DELETE CASCADE, tier_number INTEGER NOT NULL, min_tokens DOUBLE PRECISION NOT NULL, max_tokens DOUBLE PRECISION, position INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_tiered_reward_tiers_config ON tiered_reward_tiers(config_id);
CREATE TABLE IF NOT EXISTS tiered_reward_assets (id TEXT PRIMARY KEY, tier_id TEXT NOT NULL REFERENCES tiered_reward_tiers(id) ON DELETE CASCADE, asset_code TEXT NOT NULL, asset_issuer TEXT, amount DOUBLE PRECISION NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tiered_reward_assets_tier ON tiered_reward_assets(tier_id);
CREATE TABLE IF NOT EXISTS tiered_reward_run_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', config_id TEXT REFERENCES tiered_reward_configs(id) ON DELETE SET NULL, tier_number INTEGER NOT NULL, holder_address TEXT NOT NULL, asset_code TEXT NOT NULL, asset_issuer TEXT, amount_sent DOUBLE PRECISION NOT NULL, status TEXT NOT NULL, tx_hash TEXT, error TEXT, ran_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tiered_reward_run_log_user ON tiered_reward_run_log(user_id);
CREATE INDEX IF NOT EXISTS idx_tiered_reward_run_log_config ON tiered_reward_run_log(config_id, ran_at DESC);

-- Auto-Send Groups (multi-user) — was live in Supabase but missing from this tracked
-- file; see supabase-rls-migration.sql for the RLS fix that also backfills this.
CREATE TABLE IF NOT EXISTS auto_send_groups (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, network TEXT NOT NULL, secret_key TEXT NOT NULL, interval_minutes INTEGER, enabled BOOLEAN NOT NULL DEFAULT false, batch_send BOOLEAN NOT NULL DEFAULT true, batch_memo TEXT, min_reserve DOUBLE PRECISION NOT NULL DEFAULT 10.0, min_sender_threshold DOUBLE PRECISION NOT NULL DEFAULT 0, preview_only BOOLEAN NOT NULL DEFAULT false, last_failure_at BIGINT, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_auto_send_groups_user ON auto_send_groups(user_id);
CREATE TABLE IF NOT EXISTS auto_send_destinations (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES auto_send_groups(id) ON DELETE CASCADE, destination TEXT NOT NULL, percentage DOUBLE PRECISION, is_remainder BOOLEAN NOT NULL DEFAULT false, is_paused BOOLEAN NOT NULL DEFAULT false, label TEXT, memo TEXT, min_threshold DOUBLE PRECISION, max_cap DOUBLE PRECISION, position INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_auto_send_destinations_group ON auto_send_destinations(group_id);
CREATE TABLE IF NOT EXISTS auto_send_run_log (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, wallet_address TEXT NOT NULL, destination TEXT NOT NULL, amount_sent DOUBLE PRECISION, status TEXT NOT NULL, error TEXT, ran_at BIGINT NOT NULL, tx_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_auto_send_run_log_group ON auto_send_run_log(group_id, ran_at DESC);

-- Row-Level Security — run supabase-rls-migration.sql to enable RLS + owner-scoped
-- policies on every table above. Kept as a separate file (not inlined here) so it
-- can be re-run idempotently against an already-provisioned database.

-- Persons module migration (for databases provisioned before this module existed)
CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, role TEXT, notes TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_persons_user ON persons(user_id);
CREATE TABLE IF NOT EXISTS person_addresses (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE, address TEXT NOT NULL, label TEXT, added_at BIGINT NOT NULL, UNIQUE(person_id, address));
CREATE INDEX IF NOT EXISTS idx_person_addresses_person ON person_addresses(person_id);
CREATE INDEX IF NOT EXISTS idx_person_addresses_address ON person_addresses(address);
ALTER TABLE asset_groups DROP COLUMN IF EXISTS person_name;
ALTER TABLE asset_groups DROP COLUMN IF EXISTS person_role;
ALTER TABLE asset_groups ADD COLUMN IF NOT EXISTS person_id TEXT REFERENCES persons(id) ON DELETE SET NULL;
