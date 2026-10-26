-- Add the private Google Drive connection used by Vercel production.
-- This is additive: it does not alter existing accounts, projects, tasks, or attachments.
DO $office_drive$
BEGIN
  SET LOCAL search_path = public;
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(98123451);
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Unexpected database; Google Drive migration stopped';
  END IF;
  IF to_regclass('public.office_members') IS NULL
     OR to_regclass('public.office_attachments') IS NULL THEN
    RAISE EXCEPTION 'Office schema is missing; Google Drive migration stopped';
  END IF;

  CREATE TABLE IF NOT EXISTS office_drive_connections (
    id serial PRIMARY KEY,
    provider text NOT NULL DEFAULT 'google-drive',
    account_email text NOT NULL,
    refresh_token_ciphertext text NOT NULL,
    folder_id text NOT NULL,
    connected_by_id integer
      REFERENCES office_members(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS office_drive_connections_provider_idx
    ON office_drive_connections(provider);
END
$office_drive$;
