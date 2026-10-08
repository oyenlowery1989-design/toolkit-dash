-- Run after schema and RLS migration. Service-only deployment-wide spending ledger.
CREATE TABLE IF NOT EXISTS public.mainnet_executions (
  hash TEXT PRIMARY KEY, source TEXT NOT NULL, stroops BIGINT NOT NULL CHECK (stroops >= 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'submitted', 'rejected', 'unknown')),
  result_json TEXT, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mainnet_execution_time ON public.mainnet_executions(created_at);
ALTER TABLE public.mainnet_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mainnet_executions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mainnet_executions TO service_role;

CREATE OR REPLACE FUNCTION public.mainnet_budget_usage() RETURNS NUMERIC
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(stroops), 0) FROM public.mainnet_executions
  WHERE status IN ('reserved','unknown')
    OR (status IN ('submitted','rejected') AND created_at >= (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT - 86400000);
$$;

CREATE OR REPLACE FUNCTION public.reserve_mainnet_execution(p_hash TEXT, p_source TEXT, p_stroops BIGINT, p_max BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE now_ms BIGINT := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
BEGIN
  IF p_stroops < 0 OR p_max <= 0 THEN RAISE EXCEPTION 'Invalid budget'; END IF;
  -- The lock covers aggregate, duplicate/source check and insert in one transaction.
  PERFORM pg_advisory_xact_lock(728591043);
  IF EXISTS (SELECT 1 FROM public.mainnet_executions WHERE hash = p_hash) THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM public.mainnet_executions WHERE source = p_source AND status IN ('reserved','unknown')) THEN
    RAISE EXCEPTION 'This account has an unresolved execution; reconcile before retrying';
  END IF;
  IF public.mainnet_budget_usage() + p_stroops > p_max THEN RAISE EXCEPTION 'Daily deployment XLM budget would be exceeded'; END IF;
  INSERT INTO public.mainnet_executions(hash, source, stroops, status, created_at)
  VALUES(p_hash, p_source, p_stroops, 'reserved', now_ms);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.mainnet_budget_usage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_mainnet_execution(TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mainnet_budget_usage() TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_mainnet_execution(TEXT, TEXT, BIGINT, BIGINT) TO service_role;

CREATE TABLE IF NOT EXISTS public.scheduled_jobs (
  kind TEXT NOT NULL, resource_id TEXT NOT NULL, interval_minutes INTEGER NOT NULL,
  next_run_at BIGINT NOT NULL, PRIMARY KEY(kind, resource_id)
);
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduled_jobs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_jobs TO service_role;
CREATE OR REPLACE FUNCTION public.claim_scheduled_job(p_kind TEXT, p_id TEXT, p_minutes INTEGER, p_claim BOOLEAN DEFAULT TRUE)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE now_ms BIGINT := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
current_job public.scheduled_jobs;
BEGIN
  IF p_minutes < 1 OR p_minutes > 525600 THEN RAISE EXCEPTION 'Invalid schedule interval'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_kind || ':' || p_id, 0));
  SELECT * INTO current_job FROM public.scheduled_jobs WHERE kind = p_kind AND resource_id = p_id;
  IF NOT FOUND OR current_job.interval_minutes <> p_minutes THEN
    INSERT INTO public.scheduled_jobs VALUES(p_kind, p_id, p_minutes, now_ms + p_minutes::BIGINT * 60000)
    ON CONFLICT(kind, resource_id) DO UPDATE SET interval_minutes = EXCLUDED.interval_minutes, next_run_at = EXCLUDED.next_run_at;
    RETURN FALSE;
  END IF;
  IF NOT p_claim OR current_job.next_run_at > now_ms THEN RETURN FALSE; END IF;
  UPDATE public.scheduled_jobs SET next_run_at = now_ms + p_minutes::BIGINT * 60000 WHERE kind = p_kind AND resource_id = p_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_scheduled_job(TEXT,TEXT,INTEGER,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_job(TEXT,TEXT,INTEGER,BOOLEAN) TO service_role;

-- Import pre-gateway recent history on rollout without double-counting central submissions.
INSERT INTO public.mainnet_executions(hash, source, stroops, status, created_at)
SELECT 'legacy:auto-send:' || id, wallet_address, ROUND(amount_sent * 10000000)::BIGINT, 'submitted', ran_at
FROM public.auto_send_run_log WHERE status = 'sent' AND amount_sent > 0
  AND (tx_hash IS NULL OR NOT EXISTS(SELECT 1 FROM public.mainnet_executions e WHERE e.hash = auto_send_run_log.tx_hash))
ON CONFLICT(hash) DO NOTHING;
INSERT INTO public.mainnet_executions(hash, source, stroops, status, created_at)
SELECT 'legacy:tiered:' || id, 'legacy', ROUND(amount_sent * 10000000)::BIGINT, 'submitted', ran_at
FROM public.tiered_reward_run_log WHERE status = 'sent' AND UPPER(asset_code) = 'XLM' AND amount_sent > 0
  AND (tx_hash IS NULL OR NOT EXISTS(SELECT 1 FROM public.mainnet_executions e WHERE e.hash = tiered_reward_run_log.tx_hash))
ON CONFLICT(hash) DO NOTHING;

-- Defense in depth for all service-role upsert paths: ownership is immutable.
CREATE OR REPLACE FUNCTION public.prevent_tenant_reassignment() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Tenant ownership cannot be reassigned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE table_name TEXT;
BEGIN
  FOR table_name IN SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'user_id'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS immutable_tenant ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER immutable_tenant BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment()', table_name);
  END LOOP;
END;
$$;
CREATE TABLE IF NOT EXISTS public.used_preview_approvals(hash TEXT PRIMARY KEY, consumed_at BIGINT NOT NULL);
ALTER TABLE public.used_preview_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.used_preview_approvals FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.used_preview_approvals TO service_role;
