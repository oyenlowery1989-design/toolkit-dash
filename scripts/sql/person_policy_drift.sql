\set ON_ERROR_STOP on
BEGIN;
INSERT INTO persons (id,user_id,name,created_at,updated_at) VALUES
  ('policy-a','11111111-1111-1111-1111-111111111111','A',1,1),
  ('policy-a2','11111111-1111-1111-1111-111111111111','A2',1,1),
  ('policy-b','22222222-2222-2222-2222-222222222222','B',1,1);
-- Reproduce the deployed A-only policy before exercising the forward migration.
ALTER POLICY owner_all ON person_relationships
  USING (EXISTS (SELECT 1 FROM persons p WHERE p.id=person_a_id AND auth.uid()::text=p.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM persons p WHERE p.id=person_a_id AND auth.uid()::text=p.user_id));
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
INSERT INTO person_relationships VALUES ('policy-legacy','policy-a','policy-b','related',1);
RESET ROLE;
DROP INDEX public.idx_asset_groups_person;
\ir ../../supabase/migrations/20261015093738_reconcile_person_ownership_policies.sql
\ir ../../supabase/migrations/20261015093738_reconcile_person_ownership_policies.sql
SET LOCAL ROLE authenticated;
DO $test$
DECLARE n integer;
BEGIN
  BEGIN
    INSERT INTO person_relationships VALUES ('policy-forged','policy-a','policy-b','related',1);
    RAISE EXCEPTION 'Foreign B accepted after migration';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO person_relationships VALUES ('policy-reversed','policy-b','policy-a','related',1);
    RAISE EXCEPTION 'Foreign A accepted after migration';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT FROM person_relationships WHERE id='policy-legacy') THEN
    RAISE EXCEPTION 'Existing mixed-owner relationship remains visible';
  END IF;
  INSERT INTO person_relationships VALUES ('policy-owned','policy-a','policy-a2','related',1);
  BEGIN
    UPDATE person_relationships SET person_b_id='policy-b' WHERE id='policy-owned';
    RAISE EXCEPTION 'Foreign endpoint reassignment accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE person_relationships SET type='friend' WHERE id='policy-owned';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Owned relationship update blocked'; END IF;
  DELETE FROM person_relationships WHERE id='policy-owned';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Owned relationship delete blocked'; END IF;
  INSERT INTO person_addresses (id,person_id,address,added_at) VALUES ('policy-address','policy-a','GOWNER',1);
  BEGIN
    UPDATE person_addresses SET person_id='policy-b' WHERE id='policy-address';
    RAISE EXCEPTION 'Foreign address reassignment accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO bulk_scan_state (user_id,scan_key,rows_json,updated_at)
    VALUES ('11111111-1111-1111-1111-111111111111','policy-scan','[]',1);
  BEGIN
    INSERT INTO bulk_scan_state (user_id,scan_key,rows_json,updated_at)
      VALUES ('22222222-2222-2222-2222-222222222222','policy-scan','[]',1);
    RAISE EXCEPTION 'Foreign scan accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
  IF NOT EXISTS (SELECT FROM person_relationships WHERE id='policy-legacy') THEN
    RAISE EXCEPTION 'Migration deleted existing data';
  END IF;
  IF to_regclass('public.idx_asset_groups_person') IS NULL THEN
    RAISE EXCEPTION 'Missing person foreign-key index';
  END IF;
END;
$test$;
ROLLBACK;
\echo 'Person policy drift regression passed'
