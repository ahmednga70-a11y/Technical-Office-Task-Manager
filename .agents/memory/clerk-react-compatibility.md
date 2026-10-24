---
name: React and Clerk compatibility
description: Version constraint for the web artifact's Clerk integration in this workspace.
---

Keep `react` and `react-dom` on the same app-local version. The workspace catalog is pinned to an older React patch for other artifacts, while the Clerk version used by the web app has a newer React peer requirement.

**Why:** Using the catalog version for only one of React or React DOM caused a runtime version mismatch, and using the older catalog version for both did not satisfy Clerk's peer requirement.

**How to apply:** For future changes to this app's Clerk integration, keep the two React dependencies aligned in the artifact package instead of changing the shared workspace catalog without checking the other artifacts.
