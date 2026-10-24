import { createInsertSchema } from "drizzle-zod";
import {
  date,
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

export const officeMembersTable = pgTable(
  "office_members",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
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
export type OfficeMember = z.infer<typeof insertOfficeMemberSchema>;
export type Project = typeof projectsTable.$inferSelect;
export type Task = typeof tasksTable.$inferSelect;
