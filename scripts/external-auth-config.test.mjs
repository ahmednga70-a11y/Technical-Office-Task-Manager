import assert from "node:assert/strict";
import test from "node:test";
import { validateVercelEnvironment } from "./validate-vercel-env.mjs";
import {
  externalClerkConfiguration,
  officeSignUpUrl,
  usesExternalClerk,
} from "../artifacts/api-server/src/lib/clerkConfiguration.ts";

// Synthetic fixtures only; no real account credentials or database connections.
const publicKey = `pk_test_${Buffer.from("unit-test.clerk.accounts.dev$").toString("base64")}`;
const valid = {
  VITE_CLERK_PUBLISHABLE_KEY: publicKey,
  CLERK_SECRET_KEY: "sk_test_synthetic_fixture_not_a_real_key",
  DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture",
  OFFICE_MANAGER_EMAIL: "manager@example.test",
  APP_URL: "https://office.example.test",
};

test("complete independent configuration passes without printing values", () => {
  assert.deepEqual(validateVercelEnvironment(valid), []);
});

test("each required field fails clearly when absent", () => {
  for (const name of Object.keys(valid)) {
    const errors = validateVercelEnvironment({ ...valid, [name]: "" });
    assert(errors.some((message) => message.includes(name)));
    assert(!errors.join(" ").includes(valid.CLERK_SECRET_KEY));
    assert(!errors.join(" ").includes(valid.DATABASE_URL));
  }
});

test("mixed instances, environments, and managed proxy leftovers are rejected", () => {
  assert(validateVercelEnvironment({ ...valid, CLERK_SECRET_KEY: "sk_test_••••••" }).some(e => e.includes("CLERK_SECRET_KEY")));
  assert(validateVercelEnvironment({ ...valid, CLERK_SECRET_KEY: "sk_live_fixture" }).some(e => e.includes("same test/live")));
  assert(validateVercelEnvironment({ ...valid, CLERK_PUBLISHABLE_KEY: `${publicKey}other` }).some(e => e.includes("must match")));
  assert(validateVercelEnvironment({ ...valid, VITE_CLERK_PROXY_URL: "/api/__clerk" }).some(e => e.includes("managed proxy")));
  assert(validateVercelEnvironment({ ...valid, VITE_CLERK_PUBLISHABLE_KEY: "pk_test_invalid" }).some(e => e.includes("instance domain")));
});

test("public origin and database URL are validated without connecting", () => {
  for (const APP_URL of ["http://office.example.test", "https://office.example.test/tasks", "https://user:password@office.example.test", "javascript:alert(1)"]) {
    assert(validateVercelEnvironment({ ...valid, APP_URL }).some(e => e.includes("APP_URL")));
  }
  assert(validateVercelEnvironment({ ...valid, DATABASE_URL: "https://example.test" }).some(e => e.includes("DATABASE_URL")));
});

test("Vercel uses external Clerk and local managed preview stays unchanged", () => {
  assert.equal(usesExternalClerk({ VERCEL: "1" }), true);
  assert.equal(usesExternalClerk({ CLERK_AUTH_MODE: "external" }), true);
  assert.equal(usesExternalClerk({}), false);
  assert.equal(externalClerkConfiguration(valid).publishableKey, publicKey);
  assert.equal(externalClerkConfiguration({ ...valid, CLERK_PUBLISHABLE_KEY: publicKey }).publishableKey, publicKey);
});

test("external invitations use the configured stable origin, not request headers", () => {
  const request = { protocol: "https", headers: { host: "untrusted.example.test", "x-forwarded-host": "untrusted.example.test" } };
  assert.equal(officeSignUpUrl(request, { VERCEL: "1", APP_URL: valid.APP_URL }), "https://office.example.test/sign-up");
  assert.throws(() => officeSignUpUrl(request, { VERCEL: "1" }), /APP_URL/);
  assert.equal(officeSignUpUrl({ protocol: "http", headers: { host: "localhost:3000" } }, {}), "http://localhost:3000/technical-office/sign-up");
});
