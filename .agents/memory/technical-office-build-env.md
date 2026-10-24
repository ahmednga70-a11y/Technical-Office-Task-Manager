---
name: Technical-office build environment
description: Environment required for manual production builds of the technical-office web artifact.
---

When running the technical-office Vite production build outside its managed workflow, pass `PORT` and `BASE_PATH`; this artifact's preview base path is `/technical-office`. The managed workflow provides these automatically.

**Why:** The Vite configuration rejects builds when either required environment variable is missing, so a build failure without them is an invocation issue rather than a source-code regression.

**How to apply:** Set `PORT` to an available local port and `BASE_PATH` to the artifact's preview path for manual build commands. Leave the managed workflow configuration unchanged.
