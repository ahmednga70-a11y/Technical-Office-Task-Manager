---
name: Technical-office product scope
description: The user's role and intended audience for the technical-office app.
---

The user is a technical-office manager at a company. They want a shared app for the office's projects, assigning tasks to technical-office engineers, and tracking progress.

Only the owner's designated account should have the manager role. The manager creates each engineer's username and password; there is no public self-signup or email invitation flow.

**Why:** The user stated this as the core purpose of the app and chose manager-created username/password accounts over email invitations.

**How to apply:** Keep future product work focused on the manager-and-engineer workflow for the user's technical office, with one designated manager and manager-controlled engineer accounts, rather than broadening it into generic project management.

Task actions should have visible text labels and progress changes should be
available directly, without opening the general edit form.

**Why:** The user asked: «خلى كل زراير الاوبشن بتاع المهمة واظحة بدون الدخول على التعديل».

**How to apply:** Preserve direct progress controls and clearly named actions
when changing task rows or mobile layouts; do not replace them with icon-only
or hidden-menu actions.
