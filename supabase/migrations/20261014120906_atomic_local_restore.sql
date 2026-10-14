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
