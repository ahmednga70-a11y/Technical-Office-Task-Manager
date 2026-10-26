import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { officeMembersTable, officeNotificationsTable } from "./office";

export const officePushSubscriptionsTable = pgTable("office_push_subscriptions", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => officeMembersTable.id, { onDelete: "cascade" }),
  endpointHash: text("endpoint_hash").notNull(),
  subscriptionCiphertext: text("subscription_ciphertext").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
}, table => [uniqueIndex("office_push_subscriptions_endpoint_idx").on(table.endpointHash)]);

export const officePushDeliveriesTable = pgTable("office_push_deliveries", {
  id: serial("id").primaryKey(),
  notificationId: integer("notification_id").notNull().references(() => officeNotificationsTable.id, { onDelete: "cascade" }),
  subscriptionId: integer("subscription_id").notNull().references(() => officePushSubscriptionsTable.id, { onDelete: "cascade" }),
  attempts: integer("attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastStatus: integer("last_status"),
}, table => [uniqueIndex("office_push_deliveries_pair_idx").on(table.notificationId, table.subscriptionId)]);

export const insertOfficePushSubscriptionSchema = createInsertSchema(officePushSubscriptionsTable).omit({ id: true, createdAt: true, lastSeenAt: true });
export type OfficePushSubscription = typeof officePushSubscriptionsTable.$inferSelect;
export type OfficePushDelivery = typeof officePushDeliveriesTable.$inferSelect;
