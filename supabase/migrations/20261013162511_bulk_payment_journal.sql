-- Apply before deploying the durable Bulk Payments recovery flow.
CREATE TABLE IF NOT EXISTS public.bulk_payment_journal (
  user_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- The application accesses this table only through authenticated server routes.
ALTER TABLE public.bulk_payment_journal ENABLE ROW LEVEL SECURITY;
