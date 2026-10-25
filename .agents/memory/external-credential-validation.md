---
name: External credential validation
description: Safely distinguish a copied dashboard mask from a usable external Clerk credential.
---

Check credential character format, not just its prefix, before making authenticated requests. A dashboard's masked display can retain the expected prefix while containing non-ASCII mask characters.

**Why:** Such text can fail HTTP header encoding before reaching the provider, so the resulting TypeError does not imply a network or account-permission problem. Logging the raw exception can expose an Authorization value.

**How to apply:** Report only validity flags, HTTP status, or controlled error classifications. Request a fresh copy through the secure secrets form if mask characters are detected; never print the submitted value or automatically transfer it to Vercel.
