---
name: Clerk invitation access
description: How to treat invitation emails versus actual app access control.
---

Do not treat a Clerk invitation email as an access gate by itself. A user can still create a Clerk account without an invitation; the app must validate trusted invitation metadata during membership creation and require membership before serving workspace data.

**Why:** Clerk documents invitations as an onboarding convenience, not a global sign-up restriction.

**How to apply:** In invitation-only apps, validate invitation acceptance server-side and protect every data endpoint—not just manager actions—with a membership check.

An invitation-required screen is not sufficient evidence that a manager lacks authorization. Diagnose the profile-sync HTTP result before sending invitations, seeding a manager, or changing membership records.

**Why:** The previous UI showed the same blocked screen for invitation rejection, expired sessions, network failures, and backend/database errors. A correctly configured verified manager can therefore appear blocked for an unrelated service failure.

**How to apply:** Keep the invitation rejection distinct from service, session, verification, and identity-conflict failures. Show a safe status and current account in the UI, never raw backend diagnostics, and establish which deployment URL the user is opening.
