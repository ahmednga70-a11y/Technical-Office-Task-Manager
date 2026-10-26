-- Additive migration. No existing office data or accounts are modified.
DO $office_push$
BEGIN
  SET LOCAL search_path = public;
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(98123451);
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Unexpected database; push migration stopped';
  END IF;
  IF to_regclass('public.office_members') IS NULL OR to_regclass('public.office_notifications') IS NULL THEN
    RAISE EXCEPTION 'Office schema is missing; push migration stopped';
  END IF;
  CREATE TABLE IF NOT EXISTS office_push_subscriptions (
    id serial PRIMARY KEY,
    member_id integer NOT NULL REFERENCES office_members(id) ON DELETE CASCADE,
    endpoint_hash text NOT NULL,
    subscription_ciphertext text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    last_test_at timestamptz
  );
  CREATE UNIQUE INDEX IF NOT EXISTS office_push_subscriptions_endpoint_idx ON office_push_subscriptions(endpoint_hash);
  CREATE TABLE IF NOT EXISTS office_push_deliveries (
    id serial PRIMARY KEY,
    notification_id integer NOT NULL REFERENCES office_notifications(id) ON DELETE CASCADE,
    subscription_id integer NOT NULL REFERENCES office_push_subscriptions(id) ON DELETE CASCADE,
    attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    last_status integer
  );
  CREATE UNIQUE INDEX IF NOT EXISTS office_push_deliveries_pair_idx ON office_push_deliveries(notification_id, subscription_id);
END
$office_push$;
