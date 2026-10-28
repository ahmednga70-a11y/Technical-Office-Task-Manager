import { and, eq, or, sql } from "drizzle-orm";
import {
  db, officeMembersTable as members, officeNotificationsTable as notifications,
} from "@workspace/db";

type NotificationDb = Pick<typeof db, "select" | "insert">;
type Change = {
  taskId: number | null;
  projectId: number;
  assigneeId?: number | null;
  actorId: number | null;
  type: "comment_added" | "file_added" | "task_updated";
  message: string;
  eventKey: string;
  excludeMemberIds?: number[];
};

// Called in the mutation transaction: persist the event and its inbox entries
// together. Project files are readable by all office members in this product.
export async function recordOfficeChange(tx: NotificationDb, change: Change) {
  const managerEmail = process.env.OFFICE_MANAGER_EMAIL?.trim().toLowerCase() ?? "";
  const recipients = await tx.select({ id: members.id }).from(members).where(
    change.taskId === null ? undefined : or(
      change.assigneeId == null ? undefined : eq(members.id, change.assigneeId),
      and(eq(members.role, "manager"), sql`lower(trim(${members.email})) = ${managerEmail}`),
    ),
  );
  const excluded = new Set([change.actorId, ...(change.excludeMemberIds ?? [])]);
  const rows = recipients.filter(member => !excluded.has(member.id)).map(member => ({
    memberId: member.id, taskId: change.taskId, projectId: change.projectId,
    type: change.type, message: change.message, dedupeKey: change.eventKey,
  }));
  if (rows.length) await tx.insert(notifications).values(rows).onConflictDoNothing();
}
