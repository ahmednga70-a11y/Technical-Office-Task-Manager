# Technical-office password sign-in rollout

The password sign-in implementation is opt-in. It does not change the current
Clerk deployment unless both application mode settings are explicitly changed.

## Before testing

1. Use the isolated Neon test branch, not production.
2. Confirm the database contains the existing office schema and the manager
   membership row.
3. Create a compute endpoint for the test branch only after approving the
   associated Neon usage.
4. Review and run
   `lib/db/migrations/external/0001_add_office_password_auth.sql` against that
   test branch. The migration is additive, preserves member IDs, and refuses to
   run unless the current database is named `neondb`.
5. Point a Vercel Preview deployment at the test branch. Do not change the
   Production database URL or Production auth-mode variables during testing.

## Preview environment variables

Set these only in the isolated Preview environment:

- `OFFICE_AUTH_MODE=password` on the API server.
- `VITE_OFFICE_AUTH_MODE=password` for the Vite build.
- `OFFICE_MANAGER_EMAIL` to the existing, designated manager account email.
- `OFFICE_MANAGER_INITIAL_PASSWORD` to a private password of at least 12
  characters. Never put this value in source control or chat.
- `DATABASE_URL` to the isolated Neon test branch.

The manager signs in with the configured email as the username. The server
creates that manager's password account on the first login attempt using the
initial password, and never overwrites an existing password account. Engineers
do not sign themselves up and are not emailed invitations: the manager creates
their username and password in the Team screen. A new account can optionally
be linked to an existing engineer profile by email, preserving its member ID
and task assignments. The manager can reset an account password from that
screen; resetting the active manager account revokes its sessions.

## Rollback and production

Keep Clerk configuration and existing Clerk member IDs intact during testing.
The default auth mode remains Clerk when the new mode variables are absent.
Do not enable password mode or run the migration against production until the
test login, account creation, password reset, permissions, and existing task
assignments have been verified and the owner approves the cutover.
