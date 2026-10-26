# Private Google Drive attachment storage

## Deployment prerequisites

The Vercel runtime uses Google Drive for new attachments. Replit preview continues
to use its existing App Storage. The Replit Google Drive connector is not a
credential source for Vercel.

1. Create a Google Cloud project, enable the Google Drive API, and configure
   Google Auth Platform. This does not use Google Cloud Storage.
2. Create an OAuth client of type **Web application**. Register the production
   callback URI:

   ```
   https://technical-office-task-manager.vercel.app/api/office/drive/oauth/callback
   ```

3. Add these variables to the Vercel production environment, without exposing
   their values in chat or source control:

   - `GOOGLE_DRIVE_CLIENT_ID`
   - `GOOGLE_DRIVE_CLIENT_SECRET`
   - `SESSION_SECRET` — a stable, high-entropy server secret; do not replace an
     existing value. It encrypts the stored Google refresh token.
   - `APP_URL` — the canonical production origin.

4. Confirm the exact Neon project ID, production branch and database. Review
   `lib/db/migrations/external/0002_add_office_drive_storage.sql`, test it on a
   branch, and obtain approval before applying it to production. Do not put DDL
   in build or startup hooks.
5. Deploy the application, sign in as manager, and choose **ربط حساب درايف**
   inside a project or task's attachments panel.
6. Verify multi-file upload, reopening the page, private downloads, deletion,
   unauthorized access and the 50 MB limit against the actual production
   connection before declaring the production upload problem resolved.

Google OAuth apps left in external **Testing** mode generally receive refresh
tokens that expire after seven days when requesting Drive access. Configure the
appropriate publishing status for ongoing operation.

## Privacy and reconnecting

Only the manager connects Google. Engineers use their existing office accounts.
Files are created inside an app folder and are not made public. The backend
checks office access before streaming or deleting files. Refresh tokens are
encrypted in Neon, not sent to the browser.

Reconnect using the same Google account. Changing the storage account or rotating
the encryption secret requires a reviewed migration so existing files remain
accessible.

## Current verification boundary

The implementation builds and typechecks locally. Google OAuth consent, browser
upload-session CORS, token renewal, and production file lifecycle require real
OAuth credentials and have not yet been verified. The production migration and
deployment must not be assumed complete.
