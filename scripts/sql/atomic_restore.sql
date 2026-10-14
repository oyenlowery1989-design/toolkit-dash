-- Run with psql -v ON_ERROR_STOP=1 against a disposable database loaded with supabase-schema.sql.
BEGIN;
-- Repeat with psql -v restore_integer_flags=1 to cover the existing production flag types.
\if :{?restore_integer_flags}
ALTER TABLE auto_send_groups
  ALTER COLUMN enabled DROP DEFAULT, ALTER COLUMN enabled TYPE integer USING enabled::integer, ALTER COLUMN enabled SET DEFAULT 0,
  ALTER COLUMN batch_send DROP DEFAULT, ALTER COLUMN batch_send TYPE integer USING batch_send::integer, ALTER COLUMN batch_send SET DEFAULT 1,
  ALTER COLUMN preview_only DROP DEFAULT, ALTER COLUMN preview_only TYPE integer USING preview_only::integer, ALTER COLUMN preview_only SET DEFAULT 0;
ALTER TABLE auto_send_destinations
  ALTER COLUMN is_remainder DROP DEFAULT, ALTER COLUMN is_remainder TYPE integer USING is_remainder::integer, ALTER COLUMN is_remainder SET DEFAULT 0,
  ALTER COLUMN is_paused DROP DEFAULT, ALTER COLUMN is_paused TYPE integer USING is_paused::integer, ALTER COLUMN is_paused SET DEFAULT 0;
\endif
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
CREATE FUNCTION pg_temp.restore_fails(payload jsonb, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.restore_local_backup('restore-owner', payload);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN RAISE; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected restore to fail with %', expected_state;
END;
$$;
INSERT INTO persons VALUES ('restore-victim-person', 'restore-victim', 'Victim', NULL, NULL, NULL, NULL, NULL, 1, 1);
INSERT INTO person_addresses(id,person_id,address,added_at) VALUES ('restore-victim-child','restore-victim-person','GVICTIM',1);
INSERT INTO saved_searches(user_id,type,value,created_at) VALUES ('restore-victim','asset','victim-search',1);
INSERT INTO tiered_reward_configs(id,user_id,name,asset_code,asset_issuer,created_at) VALUES ('restore-victim-config','restore-victim','Victim','XLM','',1);
SET LOCAL ROLE service_role;
SELECT public.restore_local_backup('restore-owner', '{"persons":[{"id":"restore-owner-person","name":"Owner","created_at":1,"updated_at":1}],"person_addresses":[{"id":"restore-owner-child","person_id":"restore-owner-person","address":"GOWNER","added_at":1}]}');
SELECT pg_temp.restore_fails('{"persons":[{"id":"restore-victim-person","name":"Stolen","created_at":1,"updated_at":1}]}', 'PT409');
SELECT pg_temp.restore_fails('{"person_addresses":[{"id":"restore-victim-child","person_id":"restore-owner-person","address":"GSTOLEN","added_at":1}]}', 'PT409');
SELECT pg_temp.restore_fails('{"person_addresses":[{"id":"restore-forged-child","person_id":"restore-victim-person","address":"GSTOLEN","added_at":1}]}', 'PT409');
SELECT pg_temp.restore_fails('{"person_relationships":[{"id":"restore-forged-relationship","person_a_id":"restore-owner-person","person_b_id":"restore-victim-person","type":"related","created_at":1}]}', 'PT409');
SELECT public.restore_local_backup('restore-owner', '{"saved_searches":[{"id":1,"type":"asset","value":"owner-search","label":"first","created_at":1}]}');
SELECT public.restore_local_backup('restore-owner', '{"saved_searches":[{"id":1,"type":"asset","value":"owner-search","label":"merged","created_at":2}]}');
-- Invalid last-table data must roll back earlier writes in the same function call.
SELECT pg_temp.restore_fails('{"persons":[{"id":"restore-rollback-person","name":"Rollback","created_at":1,"updated_at":1}],"tiered_reward_run_log":[{"id":"restore-invalid-log"}]}', '23502');
SELECT pg_temp.restore_fails('{"mainnet_signing_budget":[]}', '22023');
SELECT public.restore_local_backup('restore-owner', '{"bulk_payment_journal":[{"run_id":"restore-run","version":2,"payload_json":"payload","updated_at":1}],"tiered_reward_configs":[{"id":"restore-owner-config","name":"Rewards","asset_code":"XLM","asset_issuer":"","created_at":1}],"tiered_reward_run_leases":[{"resource_id":"reward-guard:restore-owner-config","lease_token":"guard","expires_at":999}]}');
SELECT pg_temp.restore_fails('{"persons":[{"id":"restore-journal-rollback","name":"Rollback","created_at":1,"updated_at":1}],"bulk_payment_journal":[{"run_id":"different-run","version":3,"payload_json":"payload","updated_at":2}]}', 'PT409');
SELECT pg_temp.restore_fails('{"persons":[{"id":"restore-guard-rollback","name":"Rollback","created_at":1,"updated_at":1}],"tiered_reward_configs":[{"id":"restore-owner-config","name":"Changed","asset_code":"XLM","asset_issuer":"","created_at":1}],"tiered_reward_run_leases":[{"resource_id":"reward-guard:restore-owner-config","lease_token":"different-guard","expires_at":1000}]}', 'PT409');
SELECT pg_temp.restore_fails('{"tiered_reward_configs":[{"id":"restore-victim-config","name":"Changed","asset_code":"XLM","asset_issuer":"","created_at":1}],"tiered_reward_run_leases":[{"resource_id":"reward-guard:restore-victim-config","lease_token":"guard","expires_at":1000}]}', 'PT409');
SELECT pg_temp.restore_fails('{"tiered_reward_run_leases":[{"resource_id":"reward-guard:restore-owner-config","lease_token":"guard","expires_at":1000}]}', 'PT409');
-- New payment journals and approval receipts remain tenant-scoped and immutable.
SELECT public.restore_local_backup('restore-owner', '{"tiered_reward_run_leases":[{"resource_id":"payment-guard:restore-owner","lease_token":"payment","expires_at":1000},{"resource_id":"reward-approval:test","lease_token":"{\"configId\":\"restore-owner-config\",\"userId\":\"restore-owner\",\"digest\":\"approved\"}","expires_at":1000}]}');
SELECT pg_temp.restore_fails('{"tiered_reward_run_leases":[{"resource_id":"payment-guard:restore-victim","lease_token":"forged","expires_at":1000}]}', 'PT409');
SELECT pg_temp.restore_fails('{"tiered_reward_run_leases":[{"resource_id":"payment-guard:restore-owner","lease_token":"different","expires_at":1000}]}', 'PT409');
SELECT pg_temp.restore_fails('{"tiered_reward_run_leases":[{"resource_id":"reward-approval:foreign","lease_token":"{\"configId\":\"restore-victim-config\",\"userId\":\"restore-owner\"}","expires_at":1000}]}', 'PT409');
SELECT pg_temp.restore_fails('{"tiered_reward_run_leases":[{"resource_id":"reward-approval:wrong-user","lease_token":"{\"configId\":\"restore-owner-config\",\"userId\":\"restore-victim\"}","expires_at":1000}]}', 'PT409');
-- Natural-key conflicts fail rather than silently rewriting IDs or deleting children.
SELECT pg_temp.restore_fails('{"person_addresses":[{"id":"restore-natural-conflict","person_id":"restore-owner-person","address":"GOWNER","added_at":1}]}', '23505');
SELECT public.restore_local_backup('restore-owner', '{"address_book":[{"public_key":"GCOMPOSITE","label":"First","created_at":1}],"app_state":[{"key":"test-key","value":"value"}],"bulk_scan_state":[{"scan_key":"test-scan","rows_json":"[]","interrupted":true,"updated_at":1}],"saved_analyses":[{"id":"restore-json","name":"JSON","asset_code":"MixedCase","issuer":"GISSUER","distrib_addresses":["GONE"],"network":"public","result_json":{"test":true},"tags":["tag"],"created_at":1}]}');
SELECT public.restore_local_backup('restore-owner', '{"address_book":[{"public_key":"GCOMPOSITE","label":"Merged","created_at":2}]}');
SELECT public.restore_local_backup('restore-owner', '{"auto_send_groups":[{"id":"restore-flags","name":"Flags","network":"public","secret_key":"","enabled":true,"batch_send":false,"preview_only":true,"created_at":1}],"auto_send_destinations":[{"id":"restore-flag-destination","group_id":"restore-flags","destination":"GFLAGS","is_paused":true,"is_remainder":false}]}');
SELECT public.restore_local_backup('restore-owner', '{"auto_send_groups":[{"id":"restore-flags","name":"Flags","network":"public","secret_key":"","enabled":false,"batch_send":true,"preview_only":false,"created_at":2}],"auto_send_destinations":[{"id":"restore-flag-destination","group_id":"restore-flags","destination":"GFLAGS","is_paused":false,"is_remainder":true}]}');
SELECT public.restore_local_backup('restore-owner', '{"auto_send_groups":[{"id":"restore-numeric-flags","name":"Numeric Flags","network":"public","secret_key":"","enabled":1,"batch_send":0,"preview_only":1,"created_at":1}]}');
SELECT pg_temp.restore_fails('{"bulk_scan_state":[{"scan_key":"invalid-flag","rows_json":"[]","interrupted":2,"updated_at":1}]}', '22023');
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT enabled::text FROM auto_send_groups WHERE id='restore-numeric-flags') IN ('true','1');
  ASSERT (SELECT batch_send::text FROM auto_send_groups WHERE id='restore-numeric-flags') IN ('false','0');
  ASSERT (SELECT preview_only::text FROM auto_send_groups WHERE id='restore-numeric-flags') IN ('true','1');
  ASSERT (SELECT enabled::text FROM auto_send_groups WHERE id='restore-flags') IN ('false','0');
  ASSERT (SELECT batch_send::text FROM auto_send_groups WHERE id='restore-flags') IN ('true','1');
  ASSERT (SELECT preview_only::text FROM auto_send_groups WHERE id='restore-flags') IN ('false','0');
  ASSERT (SELECT is_paused::text FROM auto_send_destinations WHERE id='restore-flag-destination') IN ('false','0');
  ASSERT (SELECT is_remainder::text FROM auto_send_destinations WHERE id='restore-flag-destination') IN ('true','1');
  ASSERT (SELECT label FROM address_book WHERE user_id='restore-owner' AND public_key='GCOMPOSITE') = 'Merged';
  ASSERT (SELECT interrupted FROM bulk_scan_state WHERE user_id='restore-owner' AND scan_key='test-scan');
  ASSERT (SELECT result_json FROM saved_analyses WHERE id='restore-json') = '{"test":true}'::jsonb;
  ASSERT (SELECT distrib_addresses FROM saved_analyses WHERE id='restore-json') = '["GONE"]'::jsonb;
  ASSERT (SELECT name FROM persons WHERE id='restore-victim-person') = 'Victim';
  ASSERT (SELECT person_id FROM person_addresses WHERE id='restore-victim-child') = 'restore-victim-person';
  ASSERT (SELECT count(*) FROM saved_searches WHERE user_id='restore-owner' AND value='owner-search') = 1;
  ASSERT (SELECT label FROM saved_searches WHERE user_id='restore-owner' AND value='owner-search') = 'merged';
  ASSERT (SELECT value FROM saved_searches WHERE user_id='restore-victim') = 'victim-search';
  ASSERT NOT EXISTS (SELECT FROM persons WHERE id IN ('restore-rollback-person','restore-journal-rollback','restore-guard-rollback'));
  ASSERT (SELECT name FROM tiered_reward_configs WHERE id='restore-owner-config') = 'Rewards';
  ASSERT (SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id='reward-guard:restore-owner-config') = 'guard';
  ASSERT NOT has_function_privilege('anon','public.restore_local_backup(text,jsonb)','execute');
  ASSERT NOT has_function_privilege('authenticated','public.restore_local_backup(text,jsonb)','execute');
  ASSERT has_function_privilege('service_role','public.restore_local_backup(text,jsonb)','execute');
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.restore_local_backup(text,jsonb)'::regprocedure);
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.restore_local_backup('restore-owner','{}');
    RAISE EXCEPTION 'Authenticated role could execute restore';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
