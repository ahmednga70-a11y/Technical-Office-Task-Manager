import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, pool, projectsTable, tasksTable, officeAttachmentsTable, officeShareLinksTable } from "@workspace/db";
import sharesRouter from "./officeShares";
import officeRouter from "./office";
import { GetOfficeSharedReportResponse } from "@workspace/api-zod";
import { officePasswordSessionMiddleware } from "../lib/officePasswordAuth";

// Integration test against DEVELOPMENT only. All fixtures are isolated and
// removed in finally; no existing office rows or storage objects are mutated.
test("read-only capabilities enforce project, file, method and revocation boundaries", async () => {
  assert.equal(process.env.OFFICE_AUTH_MODE, "password", "Run with OFFICE_AUTH_MODE=password");
  const app = express();
  app.use(express.json(), officePasswordSessionMiddleware, sharesRouter, officeRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const projectIds: number[] = [];
  const linkIds: number[] = [];
  const prefix = `share-regression-${randomBytes(6).toString("hex")}`;
  const read = (path: string, token?: string, method = "GET") => fetch(base + path, {
    method, headers: token ? { "X-Office-Share": token } : {},
  });
  const link = async (scope: "all" | "selected", ids: number[]) => {
    const token = randomBytes(32).toString("hex");
    const [row] = await db.insert(officeShareLinksTable).values({
      title: prefix, scope, projectIds: ids,
      tokenHash: createHash("sha256").update(token).digest("hex"),
    }).returning();
    linkIds.push(row.id);
    return { token, id: row.id };
  };
  try {
    const projects = await db.insert(projectsTable).values([0, 1, 2].map(i => ({ name: `${prefix}-${i}` }))).returning();
    projectIds.push(...projects.map(p => p.id));
    const tasks = await db.insert(tasksTable).values(projects.map(p => ({
      title: `${prefix}-task`, projectId: p.id, dueDate: "2030-01-01",
    }))).returning();
    const files = await db.insert(officeAttachmentsTable).values([
      { projectId: projects[2].id, taskId: null },
      { projectId: null, taskId: tasks[2].id },
      { projectId: null, taskId: tasks[0].id },
    ].map((parent, i) => ({
      ...parent, fileName: `${prefix}-${i}.pdf`, contentType: "application/pdf",
      size: 1, uploadedByName: "اختبار", objectPath: `${prefix}/${i}`, status: "ready" as const,
    }))).returning();
    const single = await link("selected", [projects[0].id]);
    const multi = await link("selected", [projects[0].id, projects[1].id]);
    const all = await link("all", []);

    for (const token of [undefined, "bad", randomBytes(32).toString("hex")]) {
      assert.equal((await read("/office/shared", token)).status, 404);
    }
    const response = await read("/office/shared", single.token);
    assert.equal(response.status, 200);
    assert.equal((await fetch(base + "/office/shared", {
      headers: { "X-Office-Share": single.token, Cookie: "office_session=expired" },
    })).status, 200, "A stale office cookie must not block a valid read-only link");
    assert.match(response.headers.get("cache-control")!, /no-store/);
    const report = GetOfficeSharedReportResponse.parse(await response.json());
    assert.deepEqual(report.projects.map((p: { id: number }) => p.id), [projects[0].id]);
    assert.deepEqual(report.tasks.map((t: { id: number }) => t.id), [tasks[0].id]);
    assert.deepEqual(report.files.map((f: { id: number }) => f.id), [files[2].id]);
    assert.equal(report.files[0].canDelete, false);
    for (const sensitive of ["objectPath", "tokenHash", "password", "clerkUserId"]) {
      assert(!JSON.stringify(report).includes(sensitive));
    }
    const multiReport = GetOfficeSharedReportResponse.parse(await (await read("/office/shared", multi.token)).json());
    assert.deepEqual(multiReport.projects.map((p: { id: number }) => p.id).sort((a: number, b: number) => a - b),
      [projects[0].id, projects[1].id]);
    assert(multiReport.tasks.every((t: { projectId: number }) => [projects[0].id, projects[1].id].includes(t.projectId)));
    for (const file of files.slice(0, 2)) {
      assert.equal((await read(`/office/shared/files/${file.id}`, single.token)).status, 404);
      assert.equal((await read(`/office/shared/files/${file.id}`, multi.token)).status, 404);
    }
    assert.equal((await read("/office/shared/files/2147483647", single.token)).status, 404);
    assert.equal((await read(`/office/attachments/${files[2].id}/content`, single.token)).status, 401);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      assert.equal((await read("/office/shared", single.token, method)).status, 401);
      assert.equal((await read(`/office/shared/files/${files[2].id}`, single.token, method)).status, 401);
      assert.equal((await read(`/tasks/${tasks[0].id}`, single.token, method)).status, 401);
    }
    for (const method of ["GET", "POST"]) {
      assert.equal((await read("/office/share-links", single.token, method)).status, 401);
    }
    assert.equal((await read(`/office/share-links/${single.id}`, single.token, "DELETE")).status, 401);
    const [future] = await db.insert(projectsTable).values({ name: `${prefix}-future` }).returning();
    projectIds.push(future.id);
    const allReport = GetOfficeSharedReportResponse.parse(await (await read("/office/shared", all.token)).json());
    assert(allReport.projects.some((p: { id: number }) => p.id === future.id));
    const singleReport = GetOfficeSharedReportResponse.parse(await (await read("/office/shared", single.token)).json());
    assert(!singleReport.projects.some(p => p.id === future.id));

    await db.update(officeShareLinksTable).set({ revokedAt: new Date() }).where(eq(officeShareLinksTable.id, single.id));
    assert.equal((await read("/office/shared", single.token)).status, 404);
    assert.equal((await read(`/office/shared/files/${files[2].id}`, single.token)).status, 404);
    await db.delete(projectsTable).where(eq(projectsTable.id, projects[1].id));
    const afterDelete = GetOfficeSharedReportResponse.parse(await (await read("/office/shared", multi.token)).json());
    assert.deepEqual(afterDelete.projects.map((p: { id: number }) => p.id), [projects[0].id]);
  } finally {
    if (linkIds.length) await db.delete(officeShareLinksTable).where(inArray(officeShareLinksTable.id, linkIds));
    if (projectIds.length) await db.delete(projectsTable).where(inArray(projectsTable.id, projectIds));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});
