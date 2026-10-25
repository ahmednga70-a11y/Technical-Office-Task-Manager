-- Additive authentication migration for the isolated Neon test branch first.
-- Do not run automatically at build time, server startup, or during requests.
-- Preserves every existing office member ID and all task/project references.
DO $office_auth$
BEGIN
  SET LOCAL search_path = public;
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(98123451);
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Unexpected database; authentication migration stopped';
  END IF;
  IF to_regclass('public.office_members') IS NULL THEN
    RAISE EXCEPTION 'office_members is missing; initialize the office schema first';
  END IF;

  ALTER TABLE office_members ALTER COLUMN clerk_user_id DROP NOT NULL;

  CREATE TABLE IF NOT EXISTS office_accounts (
    member_id integer PRIMARY KEY
      REFERENCES office_members(id) ON DELETE CASCADE,
    username text NOT NULL,
    password_hash text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS office_accounts_username_idx
    ON office_accounts(username);

  CREATE TABLE IF NOT EXISTS office_auth_sessions (
    id serial PRIMARY KEY,
    token_hash text NOT NULL,
    member_id integer NOT NULL
      REFERENCES office_members(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
  );
  CREATE UNIQUE INDEX IF NOT EXISTS office_auth_sessions_token_hash_idx
    ON office_auth_sessions(token_hash);
  CREATE INDEX IF NOT EXISTS office_auth_sessions_member_idx
    ON office_auth_sessions(member_id, expires_at);

  CREATE TABLE IF NOT EXISTS office_auth_login_attempts (
    username_hash text PRIMARY KEY,
    attempt_count integer NOT NULL DEFAULT 0,
    window_started_at timestamp with time zone NOT NULL,
    locked_until timestamp with time zone
  );
END;
$office_auth$;
