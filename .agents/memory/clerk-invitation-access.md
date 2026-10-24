---
name: Clerk invitation access
description: How to treat invitation emails versus actual app access control.
---

Do not treat a Clerk invitation email as an access gate by itself. A user can still create a Clerk account without an invitation; the app must validate trusted invitation metadata during membership creation and require membership before serving workspace data.

**Why:** Clerk documents invitations as an onboarding convenience, not a global sign-up restriction.

**How to apply:** In invitation-only apps, validate invitation acceptance server-side and protect every data endpoint—not just manager actions—with a membership check.
