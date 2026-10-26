import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createECDH } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { eq, sql } from "drizzle-orm";
import webpush from "web-push";
import {
  db, pool, officeMembersTable as members, projectsTable as projects, tasksTable as tasks,
  officeNotificationsTable as notifications, officePushSubscriptionsTable as subscriptions,
  officePushDeliveriesTable as deliveries,
} from "@workspace/db";
import { encryptSubscription, decryptSubscription, endpointHash, isAllowedPushEndpoint } from "../lib/officePushSecurity";
import { dispatchOfficePush } from "./officePush";

test("push encryption, origin restrictions, worker routing and device delivery", async t => {
  // This suite writes disposable fixtures ONLY to the local development DB.
  const current = await db.execute(sql`select current_database() as name`);
  assert.equal(current.rows[0]?.name, "heliumdb", "Refusing to run fixtures outside development");
  const vapid = webpush.generateVAPIDKeys();
  process.env.OFFICE_PUSH_PUBLIC_KEY = vapid.publicKey;
  process.env.OFFICE_PUSH_PRIVATE_KEY = vapid.privateKey;
  process.env.SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.APP_URL = "https://office.example.test";
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  const subscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-${randomUUID()}`,
    keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
  };
  await t.test("encrypted subscriptions and push endpoint SSRF boundaries", () => {
    const encrypted = encryptSubscription(subscription);
    assert.deepEqual(decryptSubscription(encrypted), subscription);
    assert.ok(!encrypted.includes(subscription.endpoint));
    const parts = encrypted.split(".");
    const changed = Buffer.from(parts[3], "base64url");
    changed[0] ^= 1;
    parts[3] = changed.toString("base64url");
    assert.throws(() => decryptSubscription(parts.join(".")));
    assert.ok(isAllowedPushEndpoint(subscription.endpoint));
    assert.ok(isAllowedPushEndpoint("https://web.push.apple.com/abc"));
    for (const endpoint of ["http://fcm.googleapis.com/a", "https://localhost/a", "https://127.0.0.1/a",
      "https://fcm.googleapis.com.evil.test/a", "https://user:pass@fcm.googleapis.com/a", "https://fcm.googleapis.com:8080/a"]) {
      assert.equal(isAllowedPushEndpoint(endpoint), false);
    }
  });
  await t.test("worker uses native sound, stable tags and scope-safe click URLs", async () => {
    const events: Record<string, (event: any) => void> = {};
    const shown: Array<{ title: string; options: any }> = [];
    const opened: string[] = [];
    const scope = "https://office.example.test/technical-office/";
    const self = {
      addEventListener: (name: string, listener: (event: any) => void) => { events[name] = listener; },
      registration: { scope, showNotification: async (title: string, options: unknown) => { shown.push({ title, options }); } },
      clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
    };
    runInNewContext(readFileSync("artifacts/technical-office/public/office-sw.js", "utf8"), { self, URL });
    for (const path of ["projects/12?taskId=45", "https://outside.example.test/", "../outside"]) {
      let done: Promise<void> = Promise.resolve();
      events.push({ data: { json: () => ({ id: 7, title: "Office", body: "New assignment", path }) }, waitUntil: (p: Promise<void>) => { done = p; } });
      await done;
    }
    assert.equal(shown[0].options.silent, false);
    assert.equal(shown[0].options.renotify, false);
    assert.equal(shown[0].options.tag, shown[1].options.tag);
    assert.equal(shown[0].options.data.url, `${scope}projects/12?taskId=45`);
    assert.equal(shown[1].options.data.url, `${scope}dashboard`);
    assert.equal(shown[2].options.data.url, `${scope}dashboard`);
    let click: Promise<void> = Promise.resolve();
    events.notificationclick({ notification: { close() {}, data: { url: shown[0].options.data.url } }, waitUntil(p: Promise<void>) { click = p; } });
    await click;
    assert.equal(opened[0], `${scope}projects/12?taskId=45`);
  });
  const token = randomUUID();
  let memberId: number | undefined;
  let projectId: number | undefined;
  try {
    const [member] = await db.insert(members).values({ clerkUserId: `push-fixture-${token}`, name: `Push fixture ${token}`, email: `push-${token}@example.invalid`, role: "engineer" }).returning();
    memberId = member.id;
    const [project] = await db.insert(projects).values({ name: `Push fixture ${token}`, startDate: "2026-01-01", endDate: "2026-12-31" }).returning();
    projectId = project.id;
    const [task] = await db.insert(tasks).values({ projectId: project.id, title: "Confidential fixture title", assigneeId: member.id, dueDate: "2026-12-01" }).returning();
    const [device] = await db.insert(subscriptions).values({
      memberId: member.id, endpointHash: endpointHash(subscription.endpoint), subscriptionCiphertext: encryptSubscription(subscription),
      createdAt: new Date(Date.now() - 60_000),
    }).returning();
    const createNotification = async (createdAt = new Date()) => {
      const [notification] = await db.insert(notifications).values({ memberId: member.id, taskId: task.id,
        type: "task_assigned", message: "Confidential fixture title", dedupeKey: randomUUID(), createdAt }).returning();
      return notification;
    };
    let calls = 0;
    const send: typeof webpush.sendNotification = async (_subscription, payload) => {
      calls += 1;
      const data = JSON.parse(String(payload));
      assert.ok(!data.body.includes("Confidential"));
      assert.equal(data.path, `projects/${project.id}?taskId=${task.id}`);
      return { statusCode: 201, body: "", headers: {} };
    };
    await t.test("one durable delivery per device and notification under concurrency", async () => {
      const notification = await createNotification();
      await Promise.all([0, 1].map(() => dispatchOfficePush({ notificationIds: [notification.id], send })));
      assert.equal(calls, 1);
      await dispatchOfficePush({ notificationIds: [notification.id], send });
      assert.equal(calls, 1);
    });
    await t.test("read notifications, old inbox entries and revoked task access never push", async () => {
      const old = await createNotification(new Date(Date.now() - 120_000));
      const read = await createNotification();
      await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, read.id));
      await dispatchOfficePush({ notificationIds: [old.id, read.id], send });
      assert.equal(calls, 1);
      const revoked = await createNotification();
      await db.update(tasks).set({ assigneeId: null }).where(eq(tasks.id, task.id));
      await dispatchOfficePush({ notificationIds: [revoked.id], send });
      assert.equal(calls, 1);
      await db.update(tasks).set({ assigneeId: member.id }).where(eq(tasks.id, task.id));
    });
    await t.test("transient failures retry later without immediate duplicate attempts", async () => {
      const notification = await createNotification();
      let failures = 0;
      const fail: typeof webpush.sendNotification = async () => { failures += 1; throw { statusCode: 503 }; };
      await dispatchOfficePush({ notificationIds: [notification.id], send: fail });
      await dispatchOfficePush({ notificationIds: [notification.id], send: fail });
      assert.equal(failures, 1);
      await db.update(deliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(deliveries.notificationId, notification.id));
      await dispatchOfficePush({ notificationIds: [notification.id], send });
      assert.equal(calls, 2);
    });
    await t.test("expired device capabilities are removed", async () => {
      const notification = await createNotification();
      await dispatchOfficePush({ notificationIds: [notification.id], send: async () => { throw { statusCode: 410 }; } });
      assert.equal((await db.select().from(subscriptions).where(eq(subscriptions.id, device.id))).length, 0);
    });
  } finally {
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    if (memberId) await db.delete(members).where(eq(members.id, memberId));
    await pool.end();
  }
});
