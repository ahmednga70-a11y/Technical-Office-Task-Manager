import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db, officeShareLinksTable, projectsTable, tasksTable,
  officeAttachmentsTable, officeMembersTable,
} from "@workspace/db";
import {
  CreateOfficeShareLinkBody, CreateOfficeShareLinkResponse,
  ListOfficeShareLinksResponse, GetOfficeSharedReportResponse,
  RevokeOfficeShareLinkParams, GetOfficeSharedFileParams,
} from "@workspace/api-zod";
import { managerOnly } from "./office";
import { sendOfficeAttachment } from "./attachments";

const router = Router();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const linkDto = (row: typeof officeShareLinksTable.$inferSelect) => ({
  id: row.id, title: row.title, scope: row.scope, projectIds: row.projectIds,
  createdAt: row.createdAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
});

// Never cache private data, even after revocation; never put bearer tokens in
// URLs, cookies, query strings, log messages, or the report response.
router.use(["/office/shared", "/office/share-links"], (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

async function sharedAccess(req: Request, res: Response) {
  const token = req.get("X-Office-Share");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    res.status(404).json({ error: "رابط المتابعة غير متاح أو تم إيقافه." });
    return;
  }
  const [link] = await db.select().from(officeShareLinksTable).where(and(
    eq(officeShareLinksTable.tokenHash, hashToken(token)), isNull(officeShareLinksTable.revokedAt),
  )).limit(1);
  if (!link) {
    res.status(404).json({ error: "رابط المتابعة غير متاح أو تم إيقافه." });
    return;
  }
  // Defensive deny on corrupt scopes. Deleted selected projects simply vanish;
  // a deleted project can never expand a link to the whole office.
  if (link.scope !== "all" && (link.scope !== "selected" || !link.projectIds.length)) {
    res.status(404).json({ error: "رابط المتابعة غير متاح." });
    return;
  }
  const projects = await db.select({
    id: projectsTable.id, name: projectsTable.name, description: projectsTable.description,
  }).from(projectsTable).where(link.scope === "all" ? undefined : inArray(projectsTable.id, link.projectIds));
  return { link, projects, projectIds: projects.map(project => project.id) };
}

router.get("/office/share-links", async (req, res): Promise<void> => {
  if (!(await managerOnly(req, res))) return;
  const links = await db.select().from(officeShareLinksTable).orderBy(desc(officeShareLinksTable.createdAt));
  res.json(ListOfficeShareLinksResponse.parse(links.map(linkDto)));
});

router.post("/office/share-links", async (req, res): Promise<void> => {
  if (!(await managerOnly(req, res))) return;
  const parsed = CreateOfficeShareLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "اكتب اسم الرابط واختر نطاق المشاريع بشكل صحيح." }); return;
  }
  const { scope } = parsed.data;
  const title = parsed.data.title.trim();
  const projectIds = [...new Set(parsed.data.projectIds)];
  if (!title || (scope === "selected" ? !projectIds.length : projectIds.length !== 0)) {
    res.status(400).json({ error: "اختر مشروعًا واحدًا على الأقل، أو اختر كل المشاريع بدون تحديد مشاريع." }); return;
  }
  if (scope === "selected") {
    const found = await db.select({ id: projectsTable.id }).from(projectsTable).where(inArray(projectsTable.id, projectIds));
    if (found.length !== projectIds.length) {
      res.status(400).json({ error: "أحد المشاريع المختارة لم يعد موجودًا. حدّث القائمة." }); return;
    }
  }
  const token = randomBytes(32).toString("hex");
  const [link] = await db.insert(officeShareLinksTable).values({
    title, scope, projectIds, tokenHash: hashToken(token),
  }).returning();
  res.status(201).json(CreateOfficeShareLinkResponse.parse({ link: linkDto(link), token }));
});

router.delete("/office/share-links/:linkId", async (req, res): Promise<void> => {
  if (!(await managerOnly(req, res))) return;
  const params = RevokeOfficeShareLinkParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "رقم الرابط غير صحيح." }); return; }
  const [link] = await db.update(officeShareLinksTable).set({ revokedAt: new Date() })
    .where(and(eq(officeShareLinksTable.id, params.data.linkId), isNull(officeShareLinksTable.revokedAt)))
    .returning({ id: officeShareLinksTable.id });
  if (!link) { res.status(404).json({ error: "الرابط غير موجود أو تم إيقافه." }); return; }
  res.sendStatus(204);
});

router.get("/office/shared", async (req, res): Promise<void> => {
  const access = await sharedAccess(req, res);
  if (!access) return;
  const ids = access.projectIds;
  const taskRows = ids.length ? await db.select({
    id: tasksTable.id, projectId: tasksTable.projectId, projectName: projectsTable.name,
    title: tasksTable.title, description: tasksTable.description, status: tasksTable.status,
    category: tasksTable.category, priority: tasksTable.priority,
    assigneeId: tasksTable.assigneeId, assigneeName: officeMembersTable.name,
    dueDate: tasksTable.dueDate, updatedAt: tasksTable.updatedAt,
  }).from(tasksTable).innerJoin(projectsTable, eq(tasksTable.projectId, projectsTable.id))
    .leftJoin(officeMembersTable, eq(tasksTable.assigneeId, officeMembersTable.id))
    .where(inArray(tasksTable.projectId, ids)).orderBy(desc(tasksTable.updatedAt)) : [];
  const taskIds = taskRows.map(task => task.id);
  const files = ids.length ? await db.select().from(officeAttachmentsTable).where(and(
    eq(officeAttachmentsTable.status, "ready"),
    or(inArray(officeAttachmentsTable.projectId, ids),
      taskIds.length ? inArray(officeAttachmentsTable.taskId, taskIds) : undefined),
  )).orderBy(desc(officeAttachmentsTable.createdAt)) : [];
  res.json(GetOfficeSharedReportResponse.parse({
    title: access.link.title, projects: access.projects,
    tasks: taskRows.map(task => ({ ...task, updatedAt: task.updatedAt.toISOString() })),
    files: files.map(file => ({
      id: file.id, projectId: file.projectId, taskId: file.taskId,
      fileName: file.fileName, contentType: file.contentType, size: file.size,
      createdAt: file.createdAt.toISOString(), uploadedByName: file.uploadedByName, canDelete: false,
    })),
    updatedAt: new Date().toISOString(),
  }));
});

router.get("/office/shared/files/:attachmentId", async (req, res): Promise<void> => {
  const params = GetOfficeSharedFileParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "الملف غير متاح." }); return; }
  const access = await sharedAccess(req, res);
  if (!access) return;
  const [file] = await db.select().from(officeAttachmentsTable).where(and(
    eq(officeAttachmentsTable.id, params.data.attachmentId), eq(officeAttachmentsTable.status, "ready"),
  )).limit(1);
  let projectId = file?.projectId;
  if (file?.taskId) {
    const [task] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable)
      .where(eq(tasksTable.id, file.taskId)).limit(1);
    projectId = task?.projectId;
  }
  if (!file || !projectId || !access.projectIds.includes(projectId)) {
    res.status(404).json({ error: "الملف غير متاح ضمن هذا الرابط." }); return;
  }
  // Always download rather than execute potentially active content on our origin.
  await sendOfficeAttachment(res, file, true);
});

// No mutations exist for capability holders. Do not let unknown methods fall
// through to the office router (or infer auth from the sharing header).
router.all(["/office/shared", "/office/shared/{*path}"], (_req, res) => {
  res.setHeader("Allow", "GET, HEAD");
  res.status(405).json({ error: "المتابعة للقراءة فقط." });
});

export default router;
