---
name: External production hosting
description: User-selected production hosting and database for the technical-office application.
---

The user said: «ربطت التطبيق بنيون وفيرسل للنشر».

The user also chose: «استمر على Vercel وNeon وجهّز تسجيل دخول مستقل».

**Why:** This is the user's chosen production setup, separate from the local Replit preview.

**How to apply:** Preserve Neon, Vercel, and independent production authentication when diagnosing production issues. Do not replace their database with Replit's database, revert production authentication to the managed service, or assume Replit publishing updates Vercel. Do not delete the old identity tenant merely to configure the independent production instance. Do not apply production schema changes without reviewing their effects with the user.
