import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  pool, officeAccountsTable, officeAuthLoginAttemptsTable, officeAuthSessionsTable,
  officeMembersTable, projectsTable, tasksTable, taskCommentsTable,
  taskActivityTable, officeNotificationsTable, officeAttachmentsTable,
  officePushSubscriptionsTable, officePushDeliveriesTable,
} from "@workspace/db";
import { isOfficeSchemaReady } from "../lib/schemaReadiness";

const router: IRouter = Router();
const officeSchema = Object.fromEntries([
  officeMembersTable, projectsTable, tasksTable, taskCommentsTable,
  taskActivityTable, officeNotificationsTable, officeAttachmentsTable,
  ...(process.env.OFFICE_PUSH_PUBLIC_KEY ? [officePushSubscriptionsTable, officePushDeliveriesTable] : []),
].map(table => [
  getTableName(table),
  Object.values(getTableColumns(table)).map(column => column.name),
]));
type Readiness = { status: "ok" | "not_ready"; code?: string };
let readinessCache: { until: number; value: Readiness } | undefined;
let readinessInFlight: Promise<Readiness> | undefined;

async function checkReadiness(): Promise<Readiness> {
  if (readinessCache && readinessCache.until > Date.now()) return readinessCache.value;
  if (readinessInFlight) return readinessInFlight;
  readinessInFlight = (async (): Promise<Readiness> => {
    try {
      const expectedSchema = process.env.OFFICE_AUTH_MODE === "password"
        ? {
            ...officeSchema,
            ...Object.fromEntries([
              officeAccountsTable,
              officeAuthSessionsTable,
              officeAuthLoginAttemptsTable,
            ].map(table => [
              getTableName(table),
              Object.values(getTableColumns(table)).map(column => column.name),
            ])),
          }
        : officeSchema;
      // Metadata only: no office rows, identity tokens, or secret values.
      const query = {
        text: "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1::text[])",
        values: [Object.keys(expectedSchema)],
        query_timeout: 5_000,
      };
      const result = await pool.query<{ table_name: string; column_name: string }>(query);
      return isOfficeSchemaReady(expectedSchema, result.rows)
        ? { status: "ok" }
        : { status: "not_ready", code: "OFFICE_DATABASE_SCHEMA_MISSING" };
    } catch {
      return { status: "not_ready", code: "OFFICE_DATABASE_UNAVAILABLE" };
    }
  })();
  try {
    const value = await readinessInFlight;
    readinessCache = { until: Date.now() + 30_000, value };
    return value;
  } finally {
    readinessInFlight = undefined;
  }
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  const result = await checkReadiness();
  res.setHeader("Cache-Control", "no-store");
  res.status(result.status === "ok" ? 200 : 503).json(result);
});

export default router;
