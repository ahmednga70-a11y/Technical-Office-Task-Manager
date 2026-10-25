import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { officeMembersTable } from "./office";

export const officeAccountsTable = pgTable(
  "office_accounts",
  {
    memberId: integer("member_id")
      .primaryKey()
      .references(() => officeMembersTable.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("office_accounts_username_idx").on(table.username)],
);

export const officeAuthSessionsTable = pgTable(
  "office_auth_sessions",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    memberId: integer("member_id")
      .notNull()
      .references(() => officeMembersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("office_auth_sessions_token_hash_idx").on(table.tokenHash),
    index("office_auth_sessions_member_idx").on(table.memberId, table.expiresAt),
  ],
);

export const officeAuthLoginAttemptsTable = pgTable("office_auth_login_attempts", {
  usernameHash: text("username_hash").primaryKey(),
  attemptCount: integer("attempt_count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
