import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { officeMembersTable } from "./office";

export const officeDriveConnectionsTable = pgTable(
  "office_drive_connections",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull().default("google-drive"),
    accountEmail: text("account_email").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    folderId: text("folder_id").notNull(),
    connectedById: integer("connected_by_id").references(
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
    uniqueIndex("office_drive_connections_provider_idx").on(table.provider),
  ],
);

export type OfficeDriveConnection =
  typeof officeDriveConnectionsTable.$inferSelect;
