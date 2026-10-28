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
import { recordOfficeChange } from "./officeChangeNotifications";

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
  const extraMemberIds: number[] = [];
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
    await t.test("change events exclude the actor and unrelated engineers, dedupe and roll back with the mutation", async () => {
      const [manager] = await db.insert(members).values({
        clerkUserId: `events-manager-${token}`, name: "Events manager",
        email: `events-manager-${token}@example.invalid`, role: "manager",
      }).returning();
      const [unrelated] = await db.insert(members).values({
        clerkUserId: `events-other-${token}`, name: "Unrelated fixture",
        email: `events-other-${token}@example.invalid`, role: "engineer",
      }).returning();
      extraMemberIds.push(manager.id, unrelated.id);
      const previousManager = process.env.OFFICE_MANAGER_EMAIL;
      process.env.OFFICE_MANAGER_EMAIL = manager.email;
      try {
        const rollback = new Error("Rollback disposable event fixtures");
        await assert.rejects(db.transaction(async tx => {
          for (const type of ["comment_added", "file_added", "task_updated"] as const) {
            const change = {
              taskId: task.id, projectId: project.id, assigneeId: member.id,
              actorId: manager.id, type, message: "Fixture event",
              eventKey: `test-${token}-${type}`,
            };
            await recordOfficeChange(tx, change);
            await recordOfficeChange(tx, change);
            const rows = await tx.select().from(notifications).where(eq(notifications.dedupeKey, change.eventKey));
            assert.equal(rows.length, 1, "one entry for the assignee, not actor or unrelated engineer");
            assert.equal(rows[0].memberId, member.id);
          }
          await recordOfficeChange(tx, {
            taskId: task.id, projectId: project.id, assigneeId: member.id,
            actorId: member.id, type: "comment_added", message: "Engineer replied",
            eventKey: `test-${token}-reply`,
          });
          const reply = await tx.select().from(notifications).where(eq(notifications.dedupeKey, `test-${token}-reply`));
          assert.deepEqual(reply.map(row => row.memberId), [manager.id]);
          // Project files work without a task; all members can read project files.
          // Roll back the transaction so no real inbox ever receives fixture data.
          await recordOfficeChange(tx, {
            taskId: null, projectId: project.id, actorId: manager.id,
            type: "file_added", message: "Project file fixture", eventKey: `test-${token}-project`,
          });
          const projectRows = await tx.select().from(notifications).where(eq(notifications.dedupeKey, `test-${token}-project`));
          assert.ok(projectRows.some(row => row.memberId === member.id));
          assert.ok(projectRows.some(row => row.memberId === unrelated.id));
          assert.ok(projectRows.every(row => row.taskId === null && row.projectId === project.id && row.memberId !== manager.id));
          throw rollback;
        }), error => error === rollback);
        const leaked = await db.select().from(notifications).where(eq(notifications.dedupeKey, `test-${token}-project`));
        assert.equal(leaked.length, 0, "rolled-back writes must not leak inbox entries");
      } finally {
        if (previousManager === undefined) delete process.env.OFFICE_MANAGER_EMAIL;
        else process.env.OFFICE_MANAGER_EMAIL = previousManager;
      }
    });
    await t.test("project-only file push links to the project and delivers once", async () => {
      const [notification] = await db.insert(notifications).values({
        memberId: member.id, projectId: project.id, taskId: null,
        type: "file_added", message: "Private fixture filename", dedupeKey: `project-push-${token}`,
      }).returning();
      const [projectDevice] = await db.insert(subscriptions).values({
        memberId: member.id, endpointHash: endpointHash(subscription.endpoint),
        subscriptionCiphertext: encryptSubscription(subscription), createdAt: new Date(Date.now() - 60_000),
      }).onConflictDoUpdate({ target: subscriptions.endpointHash, set: { memberId: member.id } }).returning();
      let payload: { path: string; body: string } | undefined;
      const send = (async (_subscription, body) => {
        payload = JSON.parse(String(body));
        return { statusCode: 201, body: "", headers: {} };
      }) as typeof webpush.sendNotification;
      await dispatchOfficePush({ notificationIds: [notification.id], send });
      assert.equal(payload?.path, `projects/${project.id}`);
      assert.ok(!payload?.body.includes("Private fixture"));
      let repeated = 0;
      await dispatchOfficePush({ notificationIds: [notification.id], send: (async () => {
        repeated++;
        return { statusCode: 201, body: "", headers: {} };
      }) as typeof webpush.sendNotification });
      assert.equal(repeated, 0);
      assert.ok(projectDevice);
    });
  } finally {
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    if (memberId) await db.delete(members).where(eq(members.id, memberId));
    for (const id of extraMemberIds) await db.delete(members).where(eq(members.id, id));
    await pool.end();
  }
});
