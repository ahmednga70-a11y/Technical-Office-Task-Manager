# Phone notifications

## Expected behavior

- Each member explicitly enables notifications on each device from the bell
  dialog. The browser must grant permission; installation alone does not grant it.
- Native Web Push can wake the push-only service worker while the app's page is
  closed. Delivery still depends on the browser, operating system, connectivity,
  notification permissions, battery policy, and whether the browser was
  force-stopped. Do not promise delivery after a force-stop.
- Native notification sound follows the phone's notification channel, mute and
  Do Not Disturb settings. A web app cannot force a custom ringtone or bypass
  those settings. iOS requires a supported Home Screen web app.
- Foreground synthesized sound is suppressed when this device's native push is
  enabled, avoiding two app-generated sounds for one notification.
- Notification bodies are generic, without task titles or project details on
  the lock screen. Clicking opens an authenticated, permission-checked task page.
- New device registrations do not replay old unread inbox entries. Existing
  unread entries remain accessible in the notification dialog.
- Disabling a device or signing out revokes its capability/server registration;
  it does not disable another device belonging to the same member.

## Server setup

Required external production variables:

```text
OFFICE_PUSH_PUBLIC_KEY
OFFICE_PUSH_PRIVATE_KEY
CRON_SECRET
SESSION_SECRET
APP_URL
```

The first two are a matching, app-owned VAPID key pair. Generate them securely
and save directly to the hosting environment; never print private keys.
Keep the existing SESSION_SECRET stable: it also encrypts Drive credentials
and device subscriptions. Rotating VAPID keys requires device re-registration.
CRON_SECRET protects the cron endpoint and must be independently generated.
APP_URL must be the canonical HTTPS app origin.

Review and apply the additive migration only to a confirmed database with the
user's approval:

```text
lib/db/migrations/external/0003_add_office_push_notifications.sql
```

It creates device-subscription and delivery-ledger tables without altering
existing office rows. Subscription capabilities/keys are encrypted at rest.
The API accepts only known HTTPS browser push-service endpoints, and all
subscription and test operations are scoped to the authenticated member.

## Sending and scheduling

Task assignment, reassignment, return and review actions dispatch after their
database transaction commits. Delivery uses current task access, per-device
leases, retry backoff, expired-subscription removal, and stable notification tags.
Push-service acceptance is not proof the operating system displayed a message.
Retries run on the next dispatch invocation; there is no guaranteed retry SLA.

The production cron is once daily at `0 6 * * *` (UTC), plus deadline checks made
by normal application activity. This is intentionally compatible with Vercel
Hobby's once-per-day limit; Hobby can invoke it within the selected hour rather
than at an exact minute. It does not provide minute-level deadline reminders.
Do not add more frequent cron expressions without checking the hosting plan and
getting approval for any additional cost.

References:
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- https://developer.mozilla.org/en-US/docs/Web/API/Notification/silent

## Verification

`node scripts/test-office-push.mjs` creates disposable fixtures only in the
local development database. It uses an injected sender, never a real push
service, and cleans its own fixtures. It checks encryption, endpoint restrictions,
scope-safe worker navigation, native sound options, concurrent deduplication,
revoked task access, retry timing and expired subscriptions.

Browser fixture tests verify permission/registration UI, matching subscription
and test request bodies, reload synchronization, disable and logout. These
simulations are not evidence of real OS delivery.

After production setup: enable on a real phone, use the test button, then close
the app page and trigger a new authorized task notification from another device.
Confirm the native notification and task link. Do not declare closed-app delivery
verified before that real-device test.
