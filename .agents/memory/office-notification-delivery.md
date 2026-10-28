---
name: Office notification delivery expectations
description: User requires closed-app phone alerts; hosting and OS delivery constraints.
---

The user explicitly chose: «أحتاج الصوت حتى والتطبيق مغلق».

**Why:** Foreground-only sound does not meet their requested notification scope.

**How to apply:** Use native phone push for closed-page delivery, not browser
timers or foreground audio. Explain that sound follows OS notification settings;
never promise bypassing mute, Do Not Disturb, or force-stop restrictions.

Keep timed background sweeps compatible with the existing hosting plan, rather
than introducing an unapproved upgrade or claiming minute-level scheduling.

**Why:** The existing external hosting uses a plan with once-daily cron limits.

**How to apply:** Verify current provider limits before increasing frequency.
An accepted push-service response or simulated browser test is not proof that a
real phone displayed/sounded the alert while closed.

Notify the relevant users about new tasks, task changes, discussion messages,
and newly added files, not just deadlines.

**Why:** The user asked for notifications «لو فيه اى تغيير في الابلكيشن سواءمهمة جديدة او شات او ملف اتظاف».

**How to apply:** Keep these event categories covered when adding or changing
task, discussion, and file workflows, while preserving access permissions.
