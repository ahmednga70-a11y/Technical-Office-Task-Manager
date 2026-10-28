import { pgTable, serial, text, integer, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";

export const officeShareLinksTable = pgTable("office_share_links", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scope: text("scope").notNull(),
  projectIds: integer("project_ids").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, table => [
  check("office_share_links_scope_check", sql`${table.scope} IN ('all', 'selected')`),
  check("office_share_links_selection_check", sql`(${table.scope} = 'all' AND cardinality(${table.projectIds}) = 0) OR (${table.scope} = 'selected' AND cardinality(${table.projectIds}) > 0)`),
]);
export const insertOfficeShareLinkSchema = createInsertSchema(officeShareLinksTable).omit({ id: true, createdAt: true });
export type OfficeShareLink = typeof officeShareLinksTable.$inferSelect;
