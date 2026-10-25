---
name: External production hosting
description: User-selected production hosting and database for the technical-office application.
---

The user said: «ربطت التطبيق بنيون وفيرسل للنشر».

The user also chose: «استمر على Vercel وNeon وجهّز تسجيل دخول مستقل».

**Why:** This is the user's chosen production setup, separate from the local Replit preview.

**How to apply:** Preserve Neon, Vercel, and independent production authentication when diagnosing production issues. Do not replace their database with Replit's database, revert production authentication to the managed service, or assume Replit publishing updates Vercel. Do not delete the old identity tenant merely to configure the independent production instance. Do not apply production schema changes without reviewing their effects with the user.

Check external database schema readiness independently from successful page rendering, authentication-provider loading, and process liveness.

**Why:** Publishing code to Vercel does not initialize or migrate Neon. A healthy HTTP server and a verified manager identity are insufficient to prove that the database can provision office membership.

**How to apply:** Inspect only schema metadata first, confirm the actual target branch/database, and review an additive migration before authorizing any production writes.

The user confirmed the external application's Neon target: project `technical office`, branch `production`, database `neondb`.

**Why:** The user explicitly confirmed this target before authorizing schema initialization.

**How to apply:** Use this to distinguish the application's database from unrelated Neon projects. Reconfirm the live connection if hosting settings change; this confirmation does not authorize future schema changes.

Independent Clerk's production instance requires a user-owned domain and DNS setup; a `*.vercel.app` URL supports development-key testing, not final production authentication.

**Why:** Clerk's official Vercel deployment guide explicitly disallows its production instance on `*.vercel.app`, since the required DNS records cannot be set there. Source: https://clerk.com/docs/guides/development/deployment/vercel

**How to apply:** Distinguish Vercel's deployment environment label from Clerk's environment. Do not describe test-key login on the Vercel-provided domain as production-ready; plan the owned domain and key/APP_URL change before real rollout.

The user said about owning a domain: «لا، وعاوز أتجنب شراء دومين».

**Why:** The user stated this constraint while comparing lower-cost hosting alternatives.

**How to apply:** Prefer options that do not require purchasing a domain. This does not by itself authorize replacing Vercel or Clerk; explain account-migration effects and get approval before changing providers.
