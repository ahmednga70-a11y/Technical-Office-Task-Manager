import webpush from "web-push";
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  db, officeMembersTable as members, officeNotificationsTable as notifications,
  officePushDeliveriesTable as deliveries, officePushSubscriptionsTable as subscriptions,
  tasksTable as tasks, projectsTable as projects,
} from "@workspace/db";
import { decryptSubscription } from "../lib/officePushSecurity";
import { logger } from "../lib/logger";

export function pushConfiguration() {
  const publicKey = process.env.OFFICE_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.OFFICE_PUSH_PRIVATE_KEY?.trim();
  const appUrl = process.env.APP_URL?.trim();
  const configured = Boolean(publicKey && privateKey && appUrl && process.env.SESSION_SECRET);
  return { configured, publicKey: configured ? publicKey! : null, privateKey, appUrl };
}

const labels: Record<string, string> = {
  task_assigned: "لديك تكليف جديد في مهام المكتب.",
  task_returned: "أُعيدت مهمة إليك لاستكمالها.",
  task_review: "لديك مهمة بانتظار المراجعة.",
  due_soon: "اقترب موعد تسليم إحدى مهام المكتب.",
  overdue: "توجد مهمة متأخرة تحتاج إلى متابعتك.",
  task_updated: "تغيّرت بيانات أو حالة إحدى مهامك.",
  comment_added: "وصلت رسالة جديدة في نقاش إحدى مهامك.",
  file_added: "أُضيف ملف جديد إلى مساحة العمل.",
};

// Every device has a durable delivery record. A lease prevents concurrent
// requests/cron invocations from sending the same pair at the same time.
export async function dispatchOfficePush(options: {
  notificationIds?: number[];
  send?: typeof webpush.sendNotification;
} = {}): Promise<{ sent: number; failed: number }> {
  const config = pushConfiguration();
  if (!config.configured) return { sent: 0, failed: 0 };
  const now = new Date();
  const managerEmail = process.env.OFFICE_MANAGER_EMAIL?.trim().toLowerCase() ?? "";
  const canRetry = and(isNull(deliveries.sentAt), lt(deliveries.attempts, 5),
    lte(deliveries.nextAttemptAt, now), or(isNull(deliveries.lockedUntil), lt(deliveries.lockedUntil, now)));
  const candidates = await db.select({
    notification: notifications, subscription: subscriptions, projectId: projects.id,
  }).from(notifications)
    .innerJoin(subscriptions, eq(subscriptions.memberId, notifications.memberId))
    .leftJoin(tasks, eq(tasks.id, notifications.taskId))
    .innerJoin(projects, eq(projects.id, sql`coalesce(${tasks.projectId}, ${notifications.projectId})`))
    .innerJoin(members, eq(members.id, notifications.memberId))
    .leftJoin(deliveries, and(eq(deliveries.notificationId, notifications.id), eq(deliveries.subscriptionId, subscriptions.id)))
    .where(and(
      isNull(notifications.readAt),
      options.notificationIds ? inArray(notifications.id, options.notificationIds) : undefined,
      gte(notifications.createdAt, subscriptions.createdAt),
      gte(notifications.createdAt, new Date(Date.now() - 14 * 86_400_000)),
      or(
        and(isNull(notifications.taskId), sql`${notifications.projectId} is not null`),
        eq(tasks.assigneeId, members.id),
        and(eq(members.role, "manager"), sql`lower(trim(${members.email})) = ${managerEmail}`),
      ),
      or(isNull(deliveries.id), canRetry),
    )).orderBy(asc(notifications.createdAt)).limit(100);
  const summary = { sent: 0, failed: 0 };
  const stopAt = Date.now() + 18_000;
  for (let start = 0; start < candidates.length && Date.now() < stopAt; start += 8) {
    await Promise.all(candidates.slice(start, start + 8).map(async ({ notification, subscription, projectId }) => {
      const lockedUntil = new Date(Date.now() + 60_000);
      const [claim] = await db.insert(deliveries).values({
        notificationId: notification.id, subscriptionId: subscription.id, attempts: 1, lockedUntil,
      }).onConflictDoUpdate({
        target: [deliveries.notificationId, deliveries.subscriptionId],
        set: { attempts: sql`${deliveries.attempts} + 1`, lockedUntil },
        setWhere: canRetry,
      }).returning({ id: deliveries.id, attempts: deliveries.attempts });
      if (!claim) return;
      try {
        const payload = JSON.stringify({
          id: notification.id, title: "فريق المكتب الفني",
          body: labels[notification.type] ?? "لديك تنبيه جديد في مهام المكتب.",
          path: `projects/${projectId}${notification.taskId === null ? "" : `?taskId=${notification.taskId}`}`,
        });
        const response = await (options.send ?? webpush.sendNotification)(decryptSubscription(subscription.subscriptionCiphertext), payload, {
          TTL: 86_400, urgency: "normal", timeout: 3000,
          vapidDetails: { subject: new URL(config.appUrl!).origin, publicKey: config.publicKey!, privateKey: config.privateKey! },
        });
        await db.update(deliveries).set({ sentAt: new Date(), lockedUntil: null, lastStatus: response.statusCode }).where(eq(deliveries.id, claim.id));
        summary.sent += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number })?.statusCode) || 0;
        summary.failed += 1;
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(subscriptions).where(eq(subscriptions.id, subscription.id));
        } else {
          await db.update(deliveries).set({
            lockedUntil: null, lastStatus: statusCode,
            nextAttemptAt: new Date(Date.now() + Math.min(24 * 60, 2 ** claim.attempts) * 60_000),
          }).where(eq(deliveries.id, claim.id));
        }
        // Never log endpoint capabilities, encrypted keys, payloads or provider response bodies.
        logger.warn({ statusCode }, "Office push delivery failed");
      }
    }));
  }
  return summary;
}

export async function tryDispatchOfficePush(): Promise<void> {
  try { await dispatchOfficePush(); }
  catch { logger.error({ code: "PUSH_DISPATCH_UNAVAILABLE" }, "Office push dispatch unavailable"); }
}

export async function sendOfficePushTest(subscriptionCiphertext: string): Promise<void> {
  const config = pushConfiguration();
  if (!config.configured) throw new Error("Push is not configured");
  await webpush.sendNotification(decryptSubscription(subscriptionCiphertext), JSON.stringify({
    id: `test-${Date.now()}`, title: "فريق المكتب الفني",
    body: "تنبيه تجريبي: تنبيهات الهاتف تعمل على هذا الجهاز.", path: "dashboard",
  }), { TTL: 60, timeout: 3000, urgency: "normal",
    vapidDetails: { subject: new URL(config.appUrl!).origin, publicKey: config.publicKey!, privateKey: config.privateKey! } });
}
