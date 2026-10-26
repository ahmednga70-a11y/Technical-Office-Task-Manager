---
name: Office Drive storage choice
description: User-approved Drive storage and external-hosting constraints.
---

The user chose Google Drive for production attachments while keeping Neon for
application data and Vercel for hosting. They approved a separate Google
authorization setup after clarifying that it is not Google Cloud Storage.

**Why:** The user wants Drive rather than an additional cloud file-storage
service. Replit's connected Drive account alone cannot authenticate application
code running on Vercel.

**How to apply:** Preserve the selected services. Use app-owned Google OAuth
credentials for the external runtime; never export Replit connector credentials
or make files public to work around authentication. Do not claim the production
upload issue is fixed until OAuth and a real file upload/download are verified.

Production storage selection must be explicit for its deployment target, not
silently default to the development provider when a host marker is absent.

**Why:** Misclassification can return an unusable upload URL while hiding the
Drive connection notice. This is a defensive rule, not the verified cause of
the failed browser uploads.

**How to apply:** Fix provider selection in the host-specific build and disable
uploads while the storage-readiness check is pending or has failed. Keep error
messages actionable rather than treating every storage failure as connectivity.

Server-initiated Google Drive resumable upload sessions need the application's
trusted browser origin on the initiation request.

**Why:** A live authenticated browser test confirmed Drive was connected and
session creation returned success, but the actual browser PUT failed because
Google's response omitted Access-Control-Allow-Origin. Unauthenticated health
checks and successful builds cannot verify this flow.

**How to apply:** Bind the session to the configured application origin, never
an unchecked request header. Verify the actual browser PUT and completion after
changes to upload transport; do not infer readiness from connection status.
