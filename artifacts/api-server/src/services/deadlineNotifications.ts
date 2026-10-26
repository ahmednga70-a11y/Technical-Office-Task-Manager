import { and, eq, lte, ne } from "drizzle-orm";
import {
  db,
  officeMembersTable,
  officeNotificationsTable,
  tasksTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { tryDispatchOfficePush } from "./officePush";

const DUE_SOON_DAYS = 7;
const OFFICE_TIME_ZONE = "Africa/Cairo";
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const MIN_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function officeToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) -
      Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

async function createDeadlineNotifications(): Promise<void> {
  const today = officeToday();
  const soonDate = addDays(today, DUE_SOON_DAYS);
  const [members, tasks] = await Promise.all([
    db
      .select({
        id: officeMembersTable.id,
        email: officeMembersTable.email,
        role: officeMembersTable.role,
      })
      .from(officeMembersTable),
    db
      .select()
      .from(tasksTable)
      .where(
        and(
          ne(tasksTable.status, "done"),
          lte(tasksTable.dueDate, soonDate),
        ),
      ),
  ]);

  const memberById = new Map(members.map((member) => [member.id, member]));
  const managerEmail = process.env.OFFICE_MANAGER_EMAIL?.trim().toLowerCase();
  const managerIds = members
    .filter(
      (member) =>
        managerEmail &&
        member.role === "manager" &&
        member.email.trim().toLowerCase() === managerEmail,
    )
    .map((member) => member.id);
  const notifications: Array<typeof officeNotificationsTable.$inferInsert> = [];

  for (const task of tasks) {
    const overdue = task.dueDate < today;
    const daysUntilDue = daysBetween(today, task.dueDate);
    const type = overdue ? "overdue" : "due_soon";
    const message = overdue
      ? `المهمة «${task.title}» متأخرة عن موعد التسليم بـ ${Math.abs(daysUntilDue)} يوم.`
      : daysUntilDue === 0
        ? `موعد تسليم المهمة «${task.title}» اليوم.`
        : daysUntilDue === 1
          ? `موعد تسليم المهمة «${task.title}» غدًا.`
          : `موعد تسليم المهمة «${task.title}» خلال ${daysUntilDue} أيام.`;
    const recipientIds = new Set(managerIds);
    const assignee = task.assigneeId
      ? memberById.get(task.assigneeId)
      : undefined;
    if (assignee?.role === "engineer") recipientIds.add(assignee.id);

    const dedupeKey = overdue
      ? `overdue:${task.id}:${task.dueDate}:${today}`
      : `due-soon:${task.id}:${task.dueDate}`;
    for (const memberId of recipientIds) {
      notifications.push({
        memberId,
        taskId: task.id,
        type,
        message,
        dedupeKey,
      });
    }
  }

  if (notifications.length) {
    await db
      .insert(officeNotificationsTable)
      .values(notifications)
      .onConflictDoNothing();
  }
  await tryDispatchOfficePush();
}

let activeSweep: Promise<void> | undefined;
let lastSweepStartedAt = 0;

export function runDeadlineNotificationSweep(): Promise<void> {
  if (activeSweep) return activeSweep;
  const now = Date.now();
  if (now - lastSweepStartedAt < MIN_SWEEP_INTERVAL_MS) {
    return Promise.resolve();
  }
  lastSweepStartedAt = now;
  activeSweep = createDeadlineNotifications().finally(() => {
    activeSweep = undefined;
  });
  return activeSweep;
}

let scheduler: ReturnType<typeof setInterval> | undefined;

export function startDeadlineNotificationScheduler(): void {
  if (scheduler) return;
  const sweep = () => {
    void runDeadlineNotificationSweep().catch((err: unknown) => {
      logger.error({ err }, "Deadline notification sweep failed");
    });
  };
  sweep();
  scheduler = setInterval(sweep, SWEEP_INTERVAL_MS);
  scheduler.unref?.();
}
