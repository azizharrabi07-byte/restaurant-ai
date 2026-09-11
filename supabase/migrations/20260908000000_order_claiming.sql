-- Adds columns for worker-based order claiming (first-tap-wins).
-- Run this once against your Supabase project:
--   supabase db push   (if using the CLI)
-- or paste into the SQL editor in Supabase Studio.

-- Add accepted_by columns to the orders table if they don't already exist.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS accepted_by      TEXT,
  ADD COLUMN IF NOT EXISTS accepted_by_name TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at      TIMESTAMPTZ;

-- Index so we can quickly find "who is working on this" and filter by claimant.
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status
  ON public.orders (restaurant_id, status);

CREATE INDEX IF NOT EXISTS idx_orders_accepted_by
  ON public.orders (restaurant_id, accepted_by)
  WHERE accepted_by IS NOT NULL;

-- Enable Realtime on the orders table so worker dashboards sync instantly.
-- (Idempotent: will error silently if already enabled.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END$$;
