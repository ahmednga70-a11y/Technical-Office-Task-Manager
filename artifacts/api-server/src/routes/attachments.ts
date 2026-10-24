import { and, desc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  CompleteOfficeAttachmentUploadParams,
  CompleteOfficeAttachmentUploadResponse,
  DeleteOfficeAttachmentParams,
  GetOfficeAttachmentContentParams,
  ListProjectAttachmentsParams,
  ListProjectAttachmentsResponse,
  ListTaskAttachmentsParams,
  ListTaskAttachmentsResponse,
  RequestOfficeAttachmentUploadBody,
  RequestOfficeAttachmentUploadResponse,
} from "@workspace/api-zod";
import {
  db,
  officeAttachmentsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  createOfficeObjectUpload,
  deleteOfficeObject,
  getOfficeObjectFile,
  ObjectNotFoundError,
} from "../lib/officeObjectStorage";
import {
  isConfiguredManager,
  requireMember,
  requireTaskParticipant,
} from "./office";

const router = Router();
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  dwg: "application/octet-stream",
  dxf: "application/octet-stream",
};
const INLINE_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function cleanFileName(value: string): string | undefined {
  const leaf = value.replace(/\\/g, "/").split("/").at(-1)?.trim();
  if (!leaf || leaf === "." || leaf === ".." || leaf.length > 255) {
    return undefined;
  }
  return leaf;
}

function fileContentType(fileName: string): string | undefined {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  return extension ? ALLOWED_CONTENT_TYPES[extension] : undefined;
}

function attachmentDto(
  attachment: typeof officeAttachmentsTable.$inferSelect,
  canDelete: boolean,
) {
  return {
    id: attachment.id,
    projectId: attachment.projectId,
    taskId: attachment.taskId,
    uploadedByName: attachment.uploadedByName,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
    createdAt: attachment.createdAt.toISOString(),
    canDelete,
  };
}

async function authorizeAttachment(
  req: Request,
  res: Response,
  attachment: typeof officeAttachmentsTable.$inferSelect,
) {
  if (attachment.taskId !== null) {
    const access = await requireTaskParticipant(req, res, attachment.taskId);
    if (!access) return undefined;
    return {
      member: access.member,
      isManager: await isConfiguredManager(req, access.member),
    };
  }

  const member = await requireMember(req, res);
  if (!member) return undefined;
  if (attachment.projectId === null) {
    res.status(404).json({ error: "Attachment not found." });
    return undefined;
  }
  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.id, attachment.projectId))
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return undefined;
  }
  return { member, isManager: await isConfiguredManager(req, member) };
}

async function removePendingAttachment(
  attachment: typeof officeAttachmentsTable.$inferSelect,
): Promise<void> {
  try {
    await deleteOfficeObject(attachment.objectPath);
  } catch (error) {
    logger.warn({ err: error, attachmentId: attachment.id }, "Could not clean up a failed attachment upload");
  }
  await db
    .delete(officeAttachmentsTable)
    .where(eq(officeAttachmentsTable.id, attachment.id));
}

router.get(
  "/projects/:projectId/attachments",
  async (req, res): Promise<void> => {
    const params = ListProjectAttachmentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const member = await requireMember(req, res);
    if (!member) return;
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, params.data.projectId))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const isManager = await isConfiguredManager(req, member);
    const attachments = await db
      .select()
      .from(officeAttachmentsTable)
      .where(
        and(
          eq(officeAttachmentsTable.projectId, project.id),
          eq(officeAttachmentsTable.status, "ready"),
        ),
      )
      .orderBy(desc(officeAttachmentsTable.createdAt), desc(officeAttachmentsTable.id));
    res.json(
      ListProjectAttachmentsResponse.parse(
        attachments.map((attachment) =>
          attachmentDto(
            attachment,
            isManager || attachment.uploadedById === member.id,
          ),
        ),
      ),
    );
  },
);

router.get(
  "/tasks/:taskId/attachments",
  async (req, res): Promise<void> => {
    const params = ListTaskAttachmentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const access = await requireTaskParticipant(req, res, params.data.taskId);
    if (!access) return;
    const isManager = await isConfiguredManager(req, access.member);
    const attachments = await db
      .select()
      .from(officeAttachmentsTable)
      .where(
        and(
          eq(officeAttachmentsTable.taskId, params.data.taskId),
          eq(officeAttachmentsTable.status, "ready"),
        ),
      )
      .orderBy(desc(officeAttachmentsTable.createdAt), desc(officeAttachmentsTable.id));
    res.json(
      ListTaskAttachmentsResponse.parse(
        attachments.map((attachment) =>
          attachmentDto(
            attachment,
            isManager || attachment.uploadedById === access.member.id,
          ),
        ),
      ),
    );
  },
);

router.post(
  "/office/attachments/upload-url",
  async (req, res): Promise<void> => {
    const rawSize = Number(req.body?.size);
    if (Number.isFinite(rawSize) && rawSize > MAX_ATTACHMENT_SIZE) {
      res.status(413).json({
        error: "حجم الملف يتجاوز الحد المسموح وهو ٥٠ ميجابايت.",
      });
      return;
    }
    const parsed = RequestOfficeAttachmentUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    const fileName = cleanFileName(input.fileName);
    if (!fileName) {
      res.status(400).json({ error: "اسم الملف غير صالح." });
      return;
    }
    const contentType = fileContentType(fileName);
    if (!contentType) {
      res.status(400).json({
        error: "نوع الملف غير مدعوم. استخدم PDF أو صورة أو ملف Office أو DWG/DXF.",
      });
      return;
    }

    let member: Awaited<ReturnType<typeof requireMember>>;
    if (
      input.scope === "project" &&
      input.projectId !== null &&
      input.taskId === null
    ) {
      member = await requireMember(req, res);
      if (!member) return;
      if (!(await isConfiguredManager(req, member))) {
        res.status(403).json({ error: "رفع ملفات المشروع متاح للمدير فقط." });
        return;
      }
      const [project] = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.id, input.projectId))
        .limit(1);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
    } else if (
      input.scope === "task" &&
      input.taskId !== null &&
      input.projectId === null
    ) {
      const access = await requireTaskParticipant(req, res, input.taskId);
      if (!access) return;
      member = access.member;
    } else {
      res.status(400).json({
        error: "اختَر المشروع أو المهمة التي يتبع لها الملف.",
      });
      return;
    }

    try {
      const { uploadURL, objectPath } = await createOfficeObjectUpload();
      const [attachment] = await db
        .insert(officeAttachmentsTable)
        .values({
          projectId: input.scope === "project" ? input.projectId : null,
          taskId: input.scope === "task" ? input.taskId : null,
          uploadedById: member.id,
          uploadedByName: member.name,
          fileName,
          contentType,
          size: input.size,
          objectPath,
          status: "pending",
        })
        .returning();
      res.json(
        RequestOfficeAttachmentUploadResponse.parse({
          attachmentId: attachment.id,
          uploadURL,
          contentType,
        }),
      );
    } catch (error) {
      logger.error({ err: error }, "Could not create office attachment upload");
      res.status(503).json({
        error: "تعذّر تجهيز مساحة رفع الملف. حاول مرة أخرى.",
      });
    }
  },
);

router.post(
  "/office/attachments/:attachmentId/complete",
  async (req, res): Promise<void> => {
    const params = CompleteOfficeAttachmentUploadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const member = await requireMember(req, res);
    if (!member) return;
    const [attachment] = await db
      .select()
      .from(officeAttachmentsTable)
      .where(eq(officeAttachmentsTable.id, params.data.attachmentId))
      .limit(1);
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    if (attachment.uploadedById !== member.id) {
      res.status(403).json({ error: "Only the uploader can finish this upload." });
      return;
    }
    const access = await authorizeAttachment(req, res, attachment);
    if (!access) return;
    if (attachment.status === "ready") {
      res.json(
        CompleteOfficeAttachmentUploadResponse.parse(
          attachmentDto(attachment, access.isManager || attachment.uploadedById === member.id),
        ),
      );
      return;
    }

    let file;
    try {
      file = await getOfficeObjectFile(attachment.objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(409).json({ error: "لم يصل الملف إلى التخزين بعد. حاول إكمال الرفع مرة أخرى." });
        return;
      }
      logger.error({ err: error, attachmentId: attachment.id }, "Could not verify office attachment");
      res.status(503).json({ error: "تعذّر التحقق من الملف المرفوع." });
      return;
    }

    try {
      const [metadata] = await file.getMetadata();
      const uploadedSize = Number(metadata.size ?? 0);
      if (uploadedSize > MAX_ATTACHMENT_SIZE) {
        await removePendingAttachment(attachment);
        res.status(413).json({
          error: "الملف أكبر من الحد المسموح، وتم حذف النسخة المرفوعة.",
        });
        return;
      }
      if (uploadedSize !== attachment.size || uploadedSize < 1) {
        await removePendingAttachment(attachment);
        res.status(400).json({
          error: "حجم الملف المرفوع لا يطابق حجمه المعلن. حاول رفعه من جديد.",
        });
        return;
      }
      const [completed] = await db
        .update(officeAttachmentsTable)
        .set({ status: "ready" })
        .where(
          and(
            eq(officeAttachmentsTable.id, attachment.id),
            eq(officeAttachmentsTable.status, "pending"),
          ),
        )
        .returning();
      const readyAttachment = completed ?? attachment;
      res.json(
        CompleteOfficeAttachmentUploadResponse.parse(
          attachmentDto(
            completed
              ? readyAttachment
              : { ...readyAttachment, status: "ready" },
            access.isManager || readyAttachment.uploadedById === member.id,
          ),
        ),
      );
    } catch (error) {
      logger.error({ err: error, attachmentId: attachment.id }, "Could not finish office attachment upload");
      res.status(503).json({
        error: "اكتمل رفع الملف لكن تعذّر تسجيله. أعد المحاولة.",
      });
    }
  },
);

router.get(
  "/office/attachments/:attachmentId/content",
  async (req, res): Promise<void> => {
    const params = GetOfficeAttachmentContentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const member = await requireMember(req, res);
    if (!member) return;
    const [attachment] = await db
      .select()
      .from(officeAttachmentsTable)
      .where(eq(officeAttachmentsTable.id, params.data.attachmentId))
      .limit(1);
    if (!attachment || attachment.status !== "ready") {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    if (!(await authorizeAttachment(req, res, attachment))) return;

    try {
      const file = await getOfficeObjectFile(attachment.objectPath);
      const fallbackName =
        attachment.fileName.replace(/[^\w.-]/g, "_").slice(0, 120) || "attachment";
      const encodedName = encodeURIComponent(attachment.fileName).replace(
        /['()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      const disposition = INLINE_CONTENT_TYPES.has(attachment.contentType)
        ? "inline"
        : "attachment";
      res.setHeader("Content-Type", attachment.contentType);
      res.setHeader("Content-Length", String(attachment.size));
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const stream = file.createReadStream();
      stream.on("error", (error) => {
        logger.error({ err: error, attachmentId: attachment.id }, "Could not stream office attachment");
        if (res.headersSent) res.destroy();
        else res.status(404).json({ error: "Attachment content not found." });
      });
      stream.pipe(res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Attachment content not found." });
        return;
      }
      logger.error({ err: error, attachmentId: attachment.id }, "Could not open office attachment");
      res.status(503).json({ error: "تعذّر فتح الملف." });
    }
  },
);

router.delete(
  "/office/attachments/:attachmentId",
  async (req, res): Promise<void> => {
    const params = DeleteOfficeAttachmentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const member = await requireMember(req, res);
    if (!member) return;
    const [attachment] = await db
      .select()
      .from(officeAttachmentsTable)
      .where(eq(officeAttachmentsTable.id, params.data.attachmentId))
      .limit(1);
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const isManager = await isConfiguredManager(req, member);
    const isUploader = attachment.uploadedById === member.id;
    if (attachment.taskId !== null) {
      const [task] = await db
        .select({ id: tasksTable.id, assigneeId: tasksTable.assigneeId })
        .from(tasksTable)
        .where(eq(tasksTable.id, attachment.taskId))
        .limit(1);
      if (!task) {
        res.status(404).json({ error: "Task not found." });
        return;
      }
      const canAccessTask = isManager || task.assigneeId === member.id;
      if (!canAccessTask && !isUploader) {
        res.status(403).json({ error: "You cannot access this task attachment." });
        return;
      }
    } else if (attachment.projectId !== null) {
      const [project] = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.id, attachment.projectId))
        .limit(1);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
    }
    if (!isManager && !isUploader) {
      res.status(403).json({ error: "حذف الملف متاح لرافعه أو للمدير فقط." });
      return;
    }
    try {
      await deleteOfficeObject(attachment.objectPath);
      await db
        .delete(officeAttachmentsTable)
        .where(eq(officeAttachmentsTable.id, attachment.id));
      res.sendStatus(204);
    } catch (error) {
      logger.error({ err: error, attachmentId: attachment.id }, "Could not delete office attachment");
      res.status(503).json({ error: "تعذّر حذف الملف. حاول مرة أخرى." });
    }
  },
);

export default router;
