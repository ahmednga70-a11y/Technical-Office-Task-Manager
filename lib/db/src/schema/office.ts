import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  date,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const officeRoleEnum = pgEnum("office_role", ["manager", "engineer"]);
export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "on_hold",
  "completed",
]);
export const taskCategoryEnum = pgEnum("task_category", [
  "shop_drawing",
  "submittal",
  "rfi",
  "quantity_takeoff",
  "coordination",
  "other",
]);
export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "review",
  "done",
]);
export const officeAttachmentStatusEnum = pgEnum("office_attachment_status", [
  "pending",
  "ready",
]);

export const officeMembersTable = pgTable(
  "office_members",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: officeRoleEnum("role").notNull().default("engineer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("office_members_clerk_user_id_idx").on(table.clerkUserId)],
);

export const projectsTable = pgTable(
  "office_projects",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    client: text("client").notNull().default(""),
    location: text("location").notNull().default(""),
    description: text("description").notNull().default(""),
    status: projectStatusEnum("status").notNull().default("active"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    createdById: integer("created_by_id").references(
      () => officeMembersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("office_projects_status_idx").on(table.status)],
);

export const tasksTable = pgTable(
  "office_tasks",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: taskCategoryEnum("category").notNull().default("other"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    status: taskStatusEnum("status").notNull().default("todo"),
    assigneeId: integer("assignee_id").references(() => officeMembersTable.id, {
      onDelete: "set null",
    }),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    createdById: integer("created_by_id").references(
      () => officeMembersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("office_tasks_project_id_idx").on(table.projectId),
    index("office_tasks_assignee_id_idx").on(table.assigneeId),
    index("office_tasks_status_idx").on(table.status),
    index("office_tasks_due_date_idx").on(table.dueDate),
  ],
);

export const taskCommentsTable = pgTable(
  "office_task_comments",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    authorId: integer("author_id").references(() => officeMembersTable.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("office_task_comments_task_created_idx").on(
      table.taskId,
      table.createdAt,
    ),
  ],
);

export const taskActivityTable = pgTable(
  "office_task_activity",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    actorId: integer("actor_id").references(() => officeMembersTable.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    eventType: text("event_type").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("office_task_activity_task_created_idx").on(
      table.taskId,
      table.createdAt,
    ),
  ],
);

export const officeNotificationsTable = pgTable(
  "office_notifications",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => officeMembersTable.id, { onDelete: "cascade" }),
    taskId: integer("task_id")
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("office_notifications_member_created_idx").on(
      table.memberId,
      table.createdAt,
    ),
    index("office_notifications_member_read_idx").on(
      table.memberId,
      table.readAt,
    ),
    uniqueIndex("office_notifications_member_dedupe_idx").on(
      table.memberId,
      table.dedupeKey,
    ),
  ],
);

export const officeAttachmentsTable = pgTable(
  "office_attachments",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").references(() => projectsTable.id, {
      onDelete: "cascade",
    }),
    taskId: integer("task_id").references(() => tasksTable.id, {
      onDelete: "cascade",
    }),
    uploadedById: integer("uploaded_by_id").references(
      () => officeMembersTable.id,
      { onDelete: "set null" },
    ),
    uploadedByName: text("uploaded_by_name").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    objectPath: text("object_path").notNull(),
    status: officeAttachmentStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("office_attachments_project_idx").on(table.projectId, table.createdAt),
    index("office_attachments_task_idx").on(table.taskId, table.createdAt),
    uniqueIndex("office_attachments_object_path_idx").on(table.objectPath),
    check(
      "office_attachments_exactly_one_parent_check",
      sql`(${table.projectId} IS NOT NULL AND ${table.taskId} IS NULL) OR (${table.projectId} IS NULL AND ${table.taskId} IS NOT NULL)`,
    ),
  ],
);

export const insertOfficeMemberSchema = createInsertSchema(officeMembersTable).omit({
  id: true,
  createdAt: true,
});
export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertTaskCommentSchema = createInsertSchema(taskCommentsTable).omit({
  id: true,
  createdAt: true,
});
export const insertTaskActivitySchema = createInsertSchema(taskActivityTable).omit({
  id: true,
  createdAt: true,
});
export const insertOfficeNotificationSchema = createInsertSchema(
  officeNotificationsTable,
).omit({
  id: true,
  createdAt: true,
});
export const insertOfficeAttachmentSchema = createInsertSchema(
  officeAttachmentsTable,
).omit({
  id: true,
  createdAt: true,
});
export type OfficeMember = z.infer<typeof insertOfficeMemberSchema>;
export type Project = typeof projectsTable.$inferSelect;
export type Task = typeof tasksTable.$inferSelect;
export type TaskComment = typeof taskCommentsTable.$inferSelect;
export type TaskActivity = typeof taskActivityTable.$inferSelect;
export type OfficeNotification = typeof officeNotificationsTable.$inferSelect;
export type OfficeAttachment = typeof officeAttachmentsTable.$inferSelect;
