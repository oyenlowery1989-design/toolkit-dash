-- Reconcile the four deployed owner policies without granting new table access.
DO $reconcile$
BEGIN
  -- Fresh CLI startup runs migrations before the repository's schema bootstrap.
  IF to_regclass('public.persons') IS NULL
    AND to_regclass('public.person_addresses') IS NULL
    AND to_regclass('public.person_relationships') IS NULL
    AND to_regclass('public.bulk_scan_state') IS NULL
    AND to_regclass('public.asset_groups') IS NULL THEN
    RAISE NOTICE 'Empty application schema: bootstrap installs the reconciled policies and index';
    RETURN;
  END IF;
ALTER POLICY owner_all ON public.persons
  USING ((SELECT auth.uid())::text = user_id)
  WITH CHECK ((SELECT auth.uid())::text = user_id);

ALTER POLICY owner_all ON public.person_addresses
  USING (EXISTS (SELECT 1 FROM public.persons p
    WHERE p.id = person_id AND (SELECT auth.uid())::text = p.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.persons p
    WHERE p.id = person_id AND (SELECT auth.uid())::text = p.user_id));

ALTER POLICY owner_all ON public.person_relationships
  USING (
    EXISTS (SELECT 1 FROM public.persons a
      WHERE a.id = person_a_id AND (SELECT auth.uid())::text = a.user_id)
    AND EXISTS (SELECT 1 FROM public.persons b
      WHERE b.id = person_b_id AND (SELECT auth.uid())::text = b.user_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.persons a
      WHERE a.id = person_a_id AND (SELECT auth.uid())::text = a.user_id)
    AND EXISTS (SELECT 1 FROM public.persons b
      WHERE b.id = person_b_id AND (SELECT auth.uid())::text = b.user_id)
  );

ALTER POLICY owner_all ON public.bulk_scan_state
  USING ((SELECT auth.uid())::text = user_id)
  WITH CHECK ((SELECT auth.uid())::text = user_id);

CREATE INDEX IF NOT EXISTS idx_asset_groups_person ON public.asset_groups(person_id);
END;
$reconcile$;
