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
CREATE TABLE IF NOT EXISTS bulk_payment_journal (user_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, version INTEGER NOT NULL, payload_json TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bulk_run_history_user ON bulk_run_history(user_id);
CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, role TEXT, notes TEXT, telegram_channel TEXT, telegram_link TEXT, telegram_username TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
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
CREATE TABLE IF NOT EXISTS bulk_scan_state (user_id TEXT NOT NULL, scan_key TEXT NOT NULL DEFAULT 'default', rows_json TEXT NOT NULL, interrupted BOOLEAN NOT NULL DEFAULT false, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, scan_key));
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
CREATE TABLE IF NOT EXISTS auto_send_run_leases (resource_id TEXT PRIMARY KEY, lease_token TEXT NOT NULL, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS tiered_reward_run_leases (resource_id TEXT PRIMARY KEY, lease_token TEXT NOT NULL, expires_at BIGINT NOT NULL);

-- Server-only mainnet signing safety state. No user-facing RLS policies are
-- granted; all access goes through authenticated server routes.
CREATE TABLE IF NOT EXISTS mainnet_signing_budget (bucket_key TEXT PRIMARY KEY, entries_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_creator_issuance_claims (
  network TEXT NOT NULL,
  issuer TEXT NOT NULL,
  asset_code TEXT NOT NULL,
  unsigned_xdr TEXT NOT NULL,
  unsigned_hash TEXT NOT NULL,
  signed_xdr TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (network, issuer, asset_code)
);

-- Row-Level Security — run supabase-rls-migration.sql to enable RLS + owner-scoped
-- policies on every table above. Kept as a separate file (not inlined here) so it
-- can be re-run idempotently against an already-provisioned database.

-- Persons module migration (for databases provisioned before this module existed)
CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, role TEXT, notes TEXT, telegram_username TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_persons_user ON persons(user_id);
CREATE TABLE IF NOT EXISTS person_addresses (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE, address TEXT NOT NULL, label TEXT, added_at BIGINT NOT NULL, UNIQUE(person_id, address));
CREATE INDEX IF NOT EXISTS idx_person_addresses_person ON person_addresses(person_id);
CREATE INDEX IF NOT EXISTS idx_person_addresses_address ON person_addresses(address);
ALTER TABLE asset_groups DROP COLUMN IF EXISTS person_name;
ALTER TABLE asset_groups DROP COLUMN IF EXISTS person_role;
ALTER TABLE asset_groups ADD COLUMN IF NOT EXISTS person_id TEXT REFERENCES persons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_asset_groups_person ON asset_groups(person_id);
ALTER TABLE asset_groups ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE asset_groups ADD COLUMN IF NOT EXISTS telegram_channel TEXT;
ALTER TABLE asset_groups ADD COLUMN IF NOT EXISTS telegram_link TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS telegram_channel TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS telegram_link TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS telegram_username TEXT;
CREATE TABLE IF NOT EXISTS person_relationships (id TEXT PRIMARY KEY, person_a_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE, person_b_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE, type TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_person_relationships_a ON person_relationships(person_a_id);
CREATE INDEX IF NOT EXISTS idx_person_relationships_b ON person_relationships(person_b_id);

-- Fail closed even if the policy migration has not been run yet. The service-role
-- server client continues to work, while direct Data API access remains blocked
-- until supabase-rls-migration.sql installs the owner policies.
ALTER TABLE address_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_send_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_send_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_send_run_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_run_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_payment_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_scan_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_intermediaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE proceeds_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiered_reward_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiered_reward_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiered_reward_run_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiered_reward_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_send_run_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiered_reward_run_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE mainnet_signing_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_creator_issuance_claims ENABLE ROW LEVEL SECURITY;

-- One RPC transaction: no partial restores, foreign IDs, or guard overwrites.
CREATE OR REPLACE FUNCTION public.restore_local_backup(p_user_id text, p_tables jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $restore$
DECLARE
  table_names constant text[] := ARRAY['address_book','known_intermediaries','known_creators','saved_analyses','bulk_recipients','proceeds_presets','saved_searches','bulk_run_history','persons','person_addresses','person_relationships','asset_groups','asset_group_members','wallet_folders','wallets','app_state','auto_send_groups','auto_send_destinations','auto_send_run_log','creator_children','bulk_scan_state','bulk_payment_journal','tiered_reward_configs','tiered_reward_tiers','tiered_reward_assets','tiered_reward_run_log','tiered_reward_run_leases'];
  table_name text;
  row_data jsonb;
  existing jsonb;
  candidate jsonb;
  parent_refs jsonb;
  parent_ref jsonb;
  owner_id text;
  has_user boolean;
  columns_sql text;
  updates_sql text;
  conflict_sql text;
  column_name text;
  column_type oid;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR jsonb_typeof(p_tables) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Restore requires a user and a table object' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT FROM jsonb_object_keys(p_tables) k WHERE NOT k = ANY(table_names)) THEN
    RAISE EXCEPTION 'Unknown restore table' USING ERRCODE = '22023';
  END IF;
  -- Block writers during ownership/guard checks, including insert races on absent IDs.
  FOR table_name IN SELECT unnest(table_names) ORDER BY 1 LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY table_names LOOP
    IF NOT p_tables ? table_name THEN CONTINUE; END IF;
    IF jsonb_typeof(p_tables -> table_name) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Restore table % must be an array', table_name USING ERRCODE = '22023';
    END IF;
    has_user := NOT table_name = ANY(ARRAY['asset_group_members','auto_send_destinations','auto_send_run_log','person_addresses','person_relationships','tiered_reward_assets','tiered_reward_run_leases','tiered_reward_tiers']);
    FOR row_data IN SELECT value FROM jsonb_array_elements(p_tables -> table_name) LOOP
      IF jsonb_typeof(row_data) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Invalid row in %', table_name USING ERRCODE = '22023';
      END IF;
      row_data := row_data - 'user_id';
      IF has_user THEN row_data := row_data || jsonb_build_object('user_id', p_user_id); END IF;
      IF table_name = 'saved_searches' THEN row_data := row_data - 'id'; END IF;
      existing := NULL;
      IF table_name = 'tiered_reward_run_leases' THEN
        IF row_data->>'resource_id' LIKE 'reward-guard:%' THEN
          IF NOT EXISTS (SELECT FROM jsonb_array_elements(coalesce(p_tables->'tiered_reward_configs', '[]')) c
                         WHERE c->>'id' = substr(row_data->>'resource_id', 14)) THEN
            RAISE EXCEPTION 'Reward guard has no local config' USING ERRCODE = 'PT409';
          END IF;
          SELECT user_id INTO owner_id FROM public.tiered_reward_configs WHERE id = substr(row_data->>'resource_id',14);
          IF owner_id IS DISTINCT FROM p_user_id THEN
            RAISE EXCEPTION 'Reward config is missing or belongs to another user' USING ERRCODE = 'PT409';
          END IF;
        ELSIF row_data->>'resource_id' LIKE 'reward-approval:%' THEN
          IF (row_data->>'lease_token')::jsonb->>'userId' IS DISTINCT FROM p_user_id THEN
            RAISE EXCEPTION 'Reward approval belongs to another user' USING ERRCODE = 'PT409';
          END IF;
          SELECT user_id INTO owner_id FROM public.tiered_reward_configs
            WHERE id = (row_data->>'lease_token')::jsonb->>'configId';
          IF owner_id IS DISTINCT FROM p_user_id THEN
            RAISE EXCEPTION 'Reward approval config is missing or belongs to another user' USING ERRCODE = 'PT409';
          END IF;
        ELSIF row_data->>'resource_id' IS DISTINCT FROM 'payment-guard:' || p_user_id THEN
          RAISE EXCEPTION 'Signing safety record belongs to another user' USING ERRCODE = 'PT409';
        END IF;
        SELECT to_jsonb(t) INTO existing FROM public.tiered_reward_run_leases t WHERE resource_id = row_data->>'resource_id';
        IF existing IS NOT NULL AND existing->>'lease_token' IS DISTINCT FROM row_data->>'lease_token' THEN
          RAISE EXCEPTION 'Remote reward guard differs; reconcile it before restoring' USING ERRCODE = 'PT409';
        END IF;
      ELSIF row_data ? 'id' THEN
        EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', table_name) INTO existing USING row_data->>'id';
      END IF;
      IF has_user AND existing IS NOT NULL AND existing->>'user_id' IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Existing % record belongs to another user', table_name USING ERRCODE = 'PT409';
      END IF;
      parent_refs := CASE table_name
        WHEN 'person_addresses' THEN '[["person_id", "persons"]]'::jsonb
        WHEN 'person_relationships' THEN '[["person_a_id", "persons"], ["person_b_id", "persons"]]'::jsonb
        WHEN 'asset_groups' THEN '[["person_id", "persons"]]'::jsonb
        WHEN 'asset_group_members' THEN '[["group_id", "asset_groups"]]'::jsonb
        WHEN 'wallets' THEN '[["folder_id", "wallet_folders"]]'::jsonb
        WHEN 'auto_send_destinations' THEN '[["group_id", "auto_send_groups"]]'::jsonb
        WHEN 'auto_send_run_log' THEN '[["group_id", "auto_send_groups"]]'::jsonb
        WHEN 'tiered_reward_tiers' THEN '[["config_id", "tiered_reward_configs"]]'::jsonb
        WHEN 'tiered_reward_assets' THEN '[["tier_id", "tiered_reward_tiers"]]'::jsonb
        WHEN 'tiered_reward_run_log' THEN '[["config_id", "tiered_reward_configs"]]'::jsonb
        ELSE '[]'::jsonb END;
      -- Validate incoming parents AND the old parents of an existing child ID.
      FOR candidate IN SELECT row_data UNION ALL SELECT existing WHERE existing IS NOT NULL LOOP
        FOR parent_ref IN SELECT value FROM jsonb_array_elements(parent_refs) LOOP
          IF candidate->>(parent_ref->>0) IS NULL THEN
            IF table_name = ANY(ARRAY['asset_groups','wallets','tiered_reward_run_log']) THEN CONTINUE; END IF;
            RAISE EXCEPTION 'Missing parent in %', table_name USING ERRCODE = 'PT409';
          END IF;
          IF parent_ref->>1 = 'tiered_reward_tiers' THEN
            SELECT c.user_id INTO owner_id FROM public.tiered_reward_tiers t
              JOIN public.tiered_reward_configs c ON c.id = t.config_id WHERE t.id = candidate->>(parent_ref->>0);
          ELSE
            EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1', parent_ref->>1)
              INTO owner_id USING candidate->>(parent_ref->>0);
          END IF;
          IF owner_id IS DISTINCT FROM p_user_id THEN
            RAISE EXCEPTION 'Missing or foreign parent in %', table_name USING ERRCODE = 'PT409';
          END IF;
        END LOOP;
      END LOOP;
      IF table_name = 'bulk_payment_journal' THEN
        SELECT to_jsonb(t) INTO existing FROM public.bulk_payment_journal t WHERE user_id = p_user_id;
        IF existing IS NOT NULL AND (existing->>'run_id' IS DISTINCT FROM row_data->>'run_id'
            OR (existing->>'version')::integer > (row_data->>'version')::integer
            OR ((existing->>'version')::integer = (row_data->>'version')::integer
                AND existing->>'payload_json' IS DISTINCT FROM row_data->>'payload_json')) THEN
          RAISE EXCEPTION 'Remote payment journal differs; reconcile it before restoring' USING ERRCODE = 'PT409';
        END IF;
      END IF;
      IF EXISTS (SELECT FROM jsonb_object_keys(row_data) k WHERE NOT EXISTS (
        SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid = format('public.%I', table_name)::regclass
        AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '')) THEN
        RAISE EXCEPTION 'Unknown column in %', table_name USING ERRCODE = '22023';
      END IF;
      -- Older cloud schemas store flags as integers; preserve their column types.
      FOR column_name, column_type IN
        SELECT a.attname, a.atttypid FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = format('public.%I', table_name)::regclass
          AND a.attnum > 0 AND NOT a.attisdropped AND row_data ? a.attname
      LOOP
        IF column_type = ANY(ARRAY['smallint'::regtype::oid, 'integer'::regtype::oid, 'bigint'::regtype::oid])
            AND jsonb_typeof(row_data -> column_name) = 'boolean' THEN
          row_data := jsonb_set(row_data, ARRAY[column_name],
            to_jsonb(CASE WHEN (row_data ->> column_name)::boolean THEN 1 ELSE 0 END));
        ELSIF column_type = 'boolean'::regtype::oid AND jsonb_typeof(row_data -> column_name) = 'number' THEN
          IF row_data ->> column_name NOT IN ('0', '1') THEN
            RAISE EXCEPTION 'Boolean flag % in % must be 0 or 1', column_name, table_name USING ERRCODE = '22023';
          END IF;
          row_data := jsonb_set(row_data, ARRAY[column_name], to_jsonb(row_data ->> column_name = '1'));
        END IF;
      END LOOP;
      conflict_sql := CASE table_name
        WHEN 'address_book' THEN 'user_id, public_key'
        WHEN 'known_intermediaries' THEN 'user_id, address'
        WHEN 'known_creators' THEN 'user_id, address'
        WHEN 'app_state' THEN 'user_id, key'
        WHEN 'bulk_scan_state' THEN 'user_id, scan_key'
        WHEN 'bulk_payment_journal' THEN 'user_id'
        WHEN 'saved_searches' THEN 'user_id, type, value'
        WHEN 'tiered_reward_run_leases' THEN 'resource_id'
        ELSE 'id' END;
      SELECT string_agg(format('%I', k), ', ' ORDER BY k),
             string_agg(format('%I = EXCLUDED.%I', k, k), ', ' ORDER BY k)
        INTO columns_sql, updates_sql FROM jsonb_object_keys(row_data) k;
      EXECUTE format('INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1)
        ON CONFLICT (%3$s) %4$s', table_name, columns_sql, conflict_sql,
        CASE WHEN table_name = 'tiered_reward_run_leases' THEN 'DO NOTHING' ELSE 'DO UPDATE SET ' || updates_sql END)
        USING row_data;
    END LOOP;
  END LOOP;
END;
$restore$;
REVOKE ALL ON FUNCTION public.restore_local_backup(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_local_backup(text, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
