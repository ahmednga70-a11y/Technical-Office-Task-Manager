import { Router, type IRouter, type Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, officePushSubscriptionsTable as subscriptions, officePushDeliveriesTable as deliveries } from "@workspace/db";
import { SaveOfficePushSubscriptionBody, RemoveOfficePushSubscriptionBody, TestOfficePushDeviceBody } from "@workspace/api-zod";
import { requireMember } from "./office";
import { encryptSubscription, endpointHash, isAllowedPushEndpoint } from "../lib/officePushSecurity";
import { pushConfiguration, dispatchOfficePush, sendOfficePushTest } from "../services/officePush";
import { runDeadlineNotificationSweep } from "../services/deadlineNotifications";

const router: IRouter = Router();
function sameOrigin(req: Request): boolean {
  if (req.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    const expected = process.env.VERCEL === "1"
      ? new URL(process.env.APP_URL ?? "").origin
      : `${req.get("x-forwarded-proto")?.split(",")[0].trim() || req.protocol}://${req.get("x-forwarded-host")?.split(",")[0].trim() || req.get("host")}`;
    return origin === expected;
  } catch { return false; }
}

router.get("/office/push/config", async (req, res) => {
  if (!(await requireMember(req, res))) return;
  res.setHeader("Cache-Control", "no-store");
  const config = pushConfiguration();
  if (!config.configured) { res.json({ configured: false, publicKey: null }); return; }
  try {
    await Promise.all([
      db.select().from(subscriptions).limit(1),
      db.select().from(deliveries).limit(1),
    ]);
    res.json({ configured: true, publicKey: config.publicKey });
  } catch { res.status(503).json({ error: "إعداد تنبيهات الهاتف لم يكتمل بعد." }); }
});

router.post("/office/push/subscriptions", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!sameOrigin(req)) { res.status(403).json({ error: "طلب غير مسموح." }); return; }
  if (!pushConfiguration().configured) { res.status(503).json({ error: "تنبيهات الهاتف غير مهيأة بعد." }); return; }
  const parsed = SaveOfficePushSubscriptionBody.safeParse(req.body);
  const validKey = (value: string, bytes: number) => /^[A-Za-z0-9_-]+={0,2}$/.test(value) && Buffer.from(value, "base64url").length === bytes;
  if (!parsed.success || !isAllowedPushEndpoint(parsed.data.endpoint)
    || !validKey(parsed.data.keys.p256dh, 65) || Buffer.from(parsed.data.keys.p256dh, "base64url")[0] !== 4
    || !validKey(parsed.data.keys.auth, 16)) {
    res.status(400).json({ error: "بيانات اشتراك الجهاز غير صالحة." }); return;
  }
  try {
    await db.insert(subscriptions).values({
      memberId: member.id, endpointHash: endpointHash(parsed.data.endpoint),
      subscriptionCiphertext: encryptSubscription(parsed.data),
    }).onConflictDoUpdate({
      target: subscriptions.endpointHash,
      set: {
        memberId: member.id, subscriptionCiphertext: encryptSubscription(parsed.data), lastSeenAt: new Date(),
        // A shared browser changing accounts must not receive old account deliveries.
        createdAt: sql`CASE WHEN ${subscriptions.memberId} = ${member.id} THEN ${subscriptions.createdAt} ELSE now() END`,
      },
    });
    res.json({ enabled: true });
  } catch { res.status(503).json({ error: "تعذّر حفظ اشتراك الجهاز. حاول مرة أخرى." }); }
});

router.delete("/office/push/subscriptions", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!sameOrigin(req)) { res.status(403).json({ error: "طلب غير مسموح." }); return; }
  const parsed = RemoveOfficePushSubscriptionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "بيانات الجهاز غير صالحة." }); return; }
  try {
    await db.delete(subscriptions).where(and(eq(subscriptions.memberId, member.id), eq(subscriptions.endpointHash, endpointHash(parsed.data.endpoint))));
    res.json({ enabled: false });
  } catch { res.status(503).json({ error: "تعذّر إيقاف تنبيهات الجهاز." }); }
});

router.post("/office/push/test", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!sameOrigin(req)) { res.status(403).json({ error: "طلب غير مسموح." }); return; }
  const parsed = TestOfficePushDeviceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "بيانات الجهاز غير صالحة." }); return; }
  try {
    const [subscription] = await db.update(subscriptions).set({ lastTestAt: new Date() }).where(and(
      eq(subscriptions.memberId, member.id), eq(subscriptions.endpointHash, endpointHash(parsed.data.endpoint)),
      or(isNull(subscriptions.lastTestAt), lt(subscriptions.lastTestAt, new Date(Date.now() - 30_000))),
    )).returning({ ciphertext: subscriptions.subscriptionCiphertext });
    if (!subscription) { res.status(429).json({ error: "فعّل تنبيهات هذا الجهاز، وانتظر نصف دقيقة بين الاختبارات." }); return; }
    await sendOfficePushTest(subscription.ciphertext);
    res.json({ enabled: true });
  } catch { res.status(503).json({ error: "تعذّر إرسال التنبيه التجريبي. أعد تفعيل تنبيهات هذا الجهاز." }); }
});

// This endpoint precedes the member-only office router: Vercel Cron does not
// have a user's session. It uses its separate server-side secret instead.
router.get("/office/push/dispatch", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const supplied = req.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(401).json({ error: "غير مسموح." }); return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    await runDeadlineNotificationSweep();
    res.json(await dispatchOfficePush());
  } catch { res.status(503).json({ error: "تعذّر إرسال التنبيهات المجدولة." }); }
});

export default router;
