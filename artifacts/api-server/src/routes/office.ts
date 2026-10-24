import { clerkClient, getAuth } from "@clerk/express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateProjectBody,
  CreateProjectResponse,
  CreateOfficeInvitationBody,
  CreateOfficeInvitationResponse,
  CreateTaskCommentBody,
  CreateTaskCommentParams,
  CreateTaskCommentResponse,
  CreateTaskBody,
  CreateTaskResponse,
  DeleteProjectParams,
  DeleteTaskParams,
  GetOfficeDashboardResponse,
  GetProjectParams,
  GetProjectResponse,
  GetTaskDiscussionParams,
  GetTaskDiscussionResponse,
  ListOfficeNotificationsResponse,
  ListOfficeMembersResponse,
  ListOfficeInvitationsResponse,
  ListProjectsResponse,
  ListTasksQueryParams,
  ListTasksResponse,
  MarkOfficeNotificationReadParams,
  MarkOfficeNotificationReadResponse,
  SyncOfficeProfileBody,
  SyncOfficeProfileResponse,
  UpdateProjectBody,
  UpdateProjectParams,
  UpdateProjectResponse,
  UpdateTaskBody,
  UpdateTaskParams,
  UpdateTaskResponse,
  RevokeOfficeInvitationParams,
} from "@workspace/api-zod";
import {
  db,
  officeMembersTable,
  officeNotificationsTable,
  projectsTable,
  taskActivityTable,
  taskCommentsTable,
  tasksTable,
} from "@workspace/db";
import { runDeadlineNotificationSweep } from "../services/deadlineNotifications";

const router: IRouter = Router();
const taskStatuses = ["todo", "in_progress", "review", "done"] as const;
type TaskStatus = (typeof taskStatuses)[number];

function currentClerkUserId(req: Request): string | undefined {
  return getAuth(req).userId ?? undefined;
}

function requireAuth(
  req: Request,
  res: Response,
  next: (error?: unknown) => void,
): void {
  if (!currentClerkUserId(req)) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }
  next();
}

router.use(requireAuth);

async function findMember(clerkUserId: string) {
  const [member] = await db
    .select()
    .from(officeMembersTable)
    .where(eq(officeMembersTable.clerkUserId, clerkUserId))
    .limit(1);
  return member;
}

export async function requireMember(req: Request, res: Response) {
  const userId = currentClerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return undefined;
  }
  const member = await findMember(userId);
  if (!member) {
    res.status(409).json({ error: "Complete your office profile first." });
    return undefined;
  }
  return member;
}

export function configuredManagerEmail(): string | undefined {
  const email = process.env.OFFICE_MANAGER_EMAIL?.trim().toLowerCase();
  return email || undefined;
}

async function verifiedClerkEmail(clerkUserId: string): Promise<string | undefined> {
  const user = await clerkClient.users.getUser(clerkUserId);
  const primaryEmail = user.emailAddresses.find(
    (entry) => entry.id === user.primaryEmailAddressId,
  );
  if (!primaryEmail || primaryEmail.verification?.status !== "verified") {
    return undefined;
  }
  return primaryEmail.emailAddress.trim().toLowerCase();
}

function dateToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function toDateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function dateWithOffset(days: number): string {
  const date = new Date(`${dateToday()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedDevelopmentExamples(managerId: number): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  const [existingProject] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .limit(1);
  if (existingProject) return;

  const exampleProjects = await db
    .insert(projectsTable)
    .values([
      {
        name: "مبنى إداري — نموذج تجريبي",
        client: "عميل تجريبي",
        location: "القاهرة الجديدة",
        description: "مشروع تجريبي لتجربة متابعة مهام المكتب الفني.",
        startDate: dateWithOffset(-14),
        endDate: dateWithOffset(45),
        createdById: managerId,
      },
      {
        name: "مجمع سكني — نموذج تجريبي",
        client: "عميل تجريبي",
        location: "العاصمة الإدارية",
        description: "نموذج تجريبي لمراجعات الرسومات والتنسيق.",
        startDate: dateWithOffset(-30),
        endDate: dateWithOffset(75),
        createdById: managerId,
      },
    ])
    .returning();

  await db.insert(tasksTable).values([
    {
      projectId: exampleProjects[0].id,
      title: "إعداد مخططات الدور الأرضي",
      description: "تجهيز المخططات للمراجعة الداخلية.",
      category: "shop_drawing",
      priority: "high",
      status: "in_progress",
      assigneeId: managerId,
      dueDate: dateWithOffset(2),
      createdById: managerId,
    },
    {
      projectId: exampleProjects[0].id,
      title: "مراجعة حصر كميات الأعمال المعمارية",
      description: "مراجعة الكميات قبل إرسالها للمشروع.",
      category: "quantity_takeoff",
      priority: "urgent",
      status: "review",
      assigneeId: managerId,
      dueDate: dateWithOffset(-1),
      createdById: managerId,
    },
    {
      projectId: exampleProjects[1].id,
      title: "مراجعة تعارض مسارات التكييف مع الكمرات",
      description: "تجميع الملاحظات وتجهيز استفسار فني عند الحاجة.",
      category: "rfi",
      priority: "medium",
      status: "todo",
      assigneeId: managerId,
      dueDate: dateWithOffset(5),
      createdById: managerId,
    },
  ]);
}

async function listTaskRows(projectId?: number) {
  const rows = await db
    .select({
      task: tasksTable,
      project: projectsTable,
      member: officeMembersTable,
    })
    .from(tasksTable)
    .innerJoin(projectsTable, eq(tasksTable.projectId, projectsTable.id))
    .leftJoin(officeMembersTable, eq(tasksTable.assigneeId, officeMembersTable.id))
    .orderBy(desc(tasksTable.updatedAt));
  return rows
    .filter(({ task }) => projectId === undefined || task.projectId === projectId)
    .map(({ task, project, member }) => ({
      id: task.id,
      projectId: task.projectId,
      projectName: project.name,
      title: task.title,
      description: task.description,
      category: task.category,
      priority: task.priority,
      status: task.status,
      assigneeId: task.assigneeId,
      assigneeName: member?.name ?? null,
      dueDate: task.dueDate,
      updatedAt: task.updatedAt.toISOString(),
    }));
}

async function listProjectRows() {
  const [projects, taskCounts] = await Promise.all([
    db.select().from(projectsTable).orderBy(desc(projectsTable.updatedAt)),
    db
      .select({
        projectId: tasksTable.projectId,
        taskCount: sql<number>`count(*)::int`,
        completedTaskCount: sql<number>`count(*) filter (where ${tasksTable.status} = 'done')::int`,
      })
      .from(tasksTable)
      .groupBy(tasksTable.projectId),
  ]);
  const counts = new Map(taskCounts.map((row) => [row.projectId, row]));
  return projects.map((project) => {
    const row = counts.get(project.id);
    const taskCount = row?.taskCount ?? 0;
    const completedTaskCount = row?.completedTaskCount ?? 0;
    return {
      id: project.id,
      name: project.name,
      client: project.client,
      location: project.location,
      status: project.status,
      progress: taskCount ? Math.round((completedTaskCount / taskCount) * 100) : 0,
      startDate: project.startDate,
      endDate: project.endDate,
      taskCount,
      completedTaskCount,
      updatedAt: project.updatedAt.toISOString(),
    };
  });
}

async function managerOnly(req: Request, res: Response) {
  const member = await requireMember(req, res);
  if (!member) return undefined;
  const managerEmail = configuredManagerEmail();
  if (!managerEmail) {
    res.status(503).json({ error: "Manager email is not configured." });
    return undefined;
  }
  if (!(await isConfiguredManager(req, member))) {
    res.status(403).json({ error: "Manager access is required for this action." });
    return undefined;
  }
  return member;
}

export async function isConfiguredManager(
  req: Request,
  member: Awaited<ReturnType<typeof findMember>>,
): Promise<boolean> {
  const managerEmail = configuredManagerEmail();
  const clerkUserId = currentClerkUserId(req);
  if (
    !member ||
    !managerEmail ||
    member.role !== "manager" ||
    member.email.trim().toLowerCase() !== managerEmail ||
    !clerkUserId
  ) {
    return false;
  }
  return (await verifiedClerkEmail(clerkUserId)) === managerEmail;
}

export async function requireTaskParticipant(
  req: Request,
  res: Response,
  taskId: number,
) {
  const member = await requireMember(req, res);
  if (!member) return undefined;
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return undefined;
  }
  if (
    !(await isConfiguredManager(req, member)) &&
    task.assigneeId !== member.id
  ) {
    res.status(403).json({
      error: "Only the manager or assigned engineer can access this task.",
    });
    return undefined;
  }
  return { member, task };
}

router.post("/office/profile", async (req, res): Promise<void> => {
  const parsed = SyncOfficeProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const clerkUserId = currentClerkUserId(req);
  if (!clerkUserId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }
  const managerEmail = configuredManagerEmail();
  if (!managerEmail) {
    res.status(503).json({ error: "Manager email is not configured." });
    return;
  }
  const clerk = clerkClient;
  const clerkUser = await clerk.users.getUser(clerkUserId);
  const primaryEmail = clerkUser.emailAddresses.find(
    (entry) => entry.id === clerkUser.primaryEmailAddressId,
  );
  if (!primaryEmail || primaryEmail.verification?.status !== "verified") {
    res.status(403).json({ error: "A verified primary email is required." });
    return;
  }
  const verifiedEmail = primaryEmail.emailAddress.trim().toLowerCase();

  const member = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(98123451)`);
    const [existing] = await tx
      .select()
      .from(officeMembersTable)
      .where(eq(officeMembersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (verifiedEmail === managerEmail) {
      await tx
        .update(officeMembersTable)
        .set({ role: "engineer" })
        .where(eq(officeMembersTable.role, "manager"));
      if (existing) {
        const [updated] = await tx
          .update(officeMembersTable)
          .set({ name: parsed.data.name, email: verifiedEmail, role: "manager" })
          .where(eq(officeMembersTable.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await tx
        .insert(officeMembersTable)
        .values({
          clerkUserId,
          name: parsed.data.name,
          email: verifiedEmail,
          role: "manager",
        })
        .returning();
      return created;
    }
    if (existing) {
      const [updated] = await tx
        .update(officeMembersTable)
        .set({ name: parsed.data.name, email: verifiedEmail, role: "engineer" })
        .where(eq(officeMembersTable.id, existing.id))
        .returning();
      return updated;
    }
    const invitationMetadata = clerkUser.publicMetadata as Record<string, unknown>;
    if (
      (invitationMetadata.officeWorkspace !== "technical-office" ||
        invitationMetadata.officeInvitationEmail !== verifiedEmail)
    ) {
      return undefined;
    }
    const [created] = await tx
      .insert(officeMembersTable)
      .values({
        clerkUserId,
        name: parsed.data.name,
        email: verifiedEmail,
        role: "engineer",
      })
      .returning();
    return created;
  });

  if (!member) {
    res.status(403).json({
      error: "An active invitation for this verified email is required.",
    });
    return;
  }
  if (member.role === "manager") {
    await seedDevelopmentExamples(member.id);
  }

  res.json(
    SyncOfficeProfileResponse.parse({
      id: member.id,
      clerkUserId: member.clerkUserId,
      name: member.name,
      email: member.email,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    }),
  );
});

router.use(async (req, res, next) => {
  const member = await requireMember(req, res);
  if (member) next();
});

router.get("/office/notifications", async (req, res): Promise<void> => {
  await runDeadlineNotificationSweep();
  const member = await requireMember(req, res);
  if (!member) return;
  const isManager = await isConfiguredManager(req, member);
  const visibleNotifications = isManager
    ? await db
        .select({
          notification: officeNotificationsTable,
          task: tasksTable,
          project: projectsTable,
        })
        .from(officeNotificationsTable)
        .innerJoin(
          tasksTable,
          eq(officeNotificationsTable.taskId, tasksTable.id),
        )
        .innerJoin(projectsTable, eq(tasksTable.projectId, projectsTable.id))
        .where(eq(officeNotificationsTable.memberId, member.id))
        .orderBy(desc(officeNotificationsTable.createdAt))
        .limit(50)
    : await db
        .select({
          notification: officeNotificationsTable,
          task: tasksTable,
          project: projectsTable,
        })
        .from(officeNotificationsTable)
        .innerJoin(
          tasksTable,
          eq(officeNotificationsTable.taskId, tasksTable.id),
        )
        .innerJoin(projectsTable, eq(tasksTable.projectId, projectsTable.id))
        .where(
          and(
            eq(officeNotificationsTable.memberId, member.id),
            eq(tasksTable.assigneeId, member.id),
          ),
        )
        .orderBy(desc(officeNotificationsTable.createdAt))
        .limit(50);
  const [unread] = isManager
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(officeNotificationsTable)
        .where(
          and(
            eq(officeNotificationsTable.memberId, member.id),
            isNull(officeNotificationsTable.readAt),
          ),
        )
    : await db
        .select({ count: sql<number>`count(*)::int` })
        .from(officeNotificationsTable)
        .innerJoin(
          tasksTable,
          eq(officeNotificationsTable.taskId, tasksTable.id),
        )
        .where(
          and(
            eq(officeNotificationsTable.memberId, member.id),
            eq(tasksTable.assigneeId, member.id),
            isNull(officeNotificationsTable.readAt),
          ),
        );
  res.json(
    ListOfficeNotificationsResponse.parse({
      unreadCount: unread?.count ?? 0,
      notifications: visibleNotifications.map(({ notification, task, project }) => ({
        id: notification.id,
        type: notification.type,
        taskId: task.id,
        projectId: project.id,
        taskTitle: task.title,
        projectName: project.name,
        message: notification.message,
        createdAt: notification.createdAt,
        readAt: notification.readAt,
      })),
    }),
  );
});

router.patch(
  "/office/notifications/:notificationId",
  async (req, res): Promise<void> => {
    const params = MarkOfficeNotificationReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const member = await requireMember(req, res);
    if (!member) return;
    const [notification] = await db
      .select()
      .from(officeNotificationsTable)
      .where(
        and(
          eq(officeNotificationsTable.id, params.data.notificationId),
          eq(officeNotificationsTable.memberId, member.id),
        ),
      )
      .limit(1);
    if (!notification) {
      res.status(404).json({ error: "Notification not found." });
      return;
    }
    const access = await requireTaskParticipant(req, res, notification.taskId);
    if (!access) return;
    const readAt = notification.readAt ?? new Date();
    const [updated] = await db
      .update(officeNotificationsTable)
      .set({ readAt })
      .where(eq(officeNotificationsTable.id, notification.id))
      .returning({
        id: officeNotificationsTable.id,
        readAt: officeNotificationsTable.readAt,
      });
    if (!updated) {
      res.status(404).json({ error: "Notification not found." });
      return;
    }
    res.json(MarkOfficeNotificationReadResponse.parse(updated));
  },
);

function serializeOfficeInvitation(invitation: {
  id: string;
  emailAddress: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  createdAt: number;
  expiresAt?: number;
}) {
  const expiresAt =
    invitation.expiresAt ?? invitation.createdAt + 30 * 24 * 60 * 60 * 1000;
  return {
    id: invitation.id,
    email: invitation.emailAddress,
    status: invitation.status,
    createdAt: new Date(invitation.createdAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

router.get("/office/invitations", async (req, res): Promise<void> => {
  const manager = await managerOnly(req, res);
  if (!manager) return;
  const clerk = clerkClient;
  const invitations = await clerk.invitations.getInvitationList({
    limit: 100,
    orderBy: "-created_at",
  });
  res.json(
    ListOfficeInvitationsResponse.parse(
      invitations.data
        .filter(
          (invitation) =>
            invitation.publicMetadata?.officeWorkspace === "technical-office",
        )
        .map(serializeOfficeInvitation),
    ),
  );
});

router.post("/office/invitations", async (req, res): Promise<void> => {
  const manager = await managerOnly(req, res);
  if (!manager) return;
  const parsed = CreateOfficeInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [existingMember] = await db
    .select({ id: officeMembersTable.id })
    .from(officeMembersTable)
    .where(sql`lower(${officeMembersTable.email}) = ${email}`)
    .limit(1);
  if (existingMember) {
    res.status(409).json({ error: "This email is already in the office." });
    return;
  }

  try {
    const clerk = clerkClient;
    const invitation = await clerk.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: "/technical-office/sign-up",
      ignoreExisting: true,
      publicMetadata: {
        officeWorkspace: "technical-office",
        officeInvitationEmail: email,
      },
    });
    res.status(201).json(
      CreateOfficeInvitationResponse.parse(
        serializeOfficeInvitation(invitation),
      ),
    );
  } catch (error) {
    req.log.error({ error, email }, "Unable to create office invitation");
    res.status(502).json({
      error: "The invitation could not be sent. Check the address and try again.",
    });
  }
});

router.delete(
  "/office/invitations/:invitationId",
  async (req, res): Promise<void> => {
    const manager = await managerOnly(req, res);
    if (!manager) return;
    const params = RevokeOfficeInvitationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      const clerk = clerkClient;
      await clerk.invitations.revokeInvitation(params.data.invitationId);
      res.sendStatus(204);
    } catch (error) {
      req.log.warn(
        { error, invitationId: params.data.invitationId },
        "Unable to revoke office invitation",
      );
      res.status(409).json({ error: "This invitation cannot be revoked." });
    }
  },
);

router.get("/office/members", async (_req, res): Promise<void> => {
  const managerEmail = configuredManagerEmail();
  if (!managerEmail) {
    res.status(503).json({ error: "Manager email is not configured." });
    return;
  }
  const members = await db
    .select()
    .from(officeMembersTable)
    .orderBy(officeMembersTable.name);
  res.json(
    ListOfficeMembersResponse.parse(
      members.map((member) => ({
        id: member.id,
        clerkUserId: member.clerkUserId,
        name: member.name,
        email: member.email,
        role:
          member.email.trim().toLowerCase() === managerEmail
            ? "manager"
            : "engineer",
        createdAt: member.createdAt.toISOString(),
      })),
    ),
  );
});

router.get("/office/dashboard", async (_req, res): Promise<void> => {
  const [projects, tasks] = await Promise.all([listProjectRows(), listTaskRows()]);
  const today = dateToday();
  const soon = new Date(`${today}T00:00:00.000Z`);
  soon.setUTCDate(soon.getUTCDate() + 7);
  const soonDate = soon.toISOString().slice(0, 10);
  const statusBreakdown = taskStatuses.map((status) => ({
    status,
    count: tasks.filter((task) => task.status === status).length,
  }));
  const pending = tasks.filter((task) => task.status !== "done");
  const byDueDate = [...pending].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  res.json(
    GetOfficeDashboardResponse.parse({
      projectCount: projects.length,
      activeProjectCount: projects.filter((project) => project.status === "active")
        .length,
      taskCount: tasks.length,
      completedTaskCount: tasks.filter((task) => task.status === "done").length,
      overdueTaskCount: pending.filter((task) => task.dueDate < today).length,
      dueSoonTaskCount: pending.filter(
        (task) => task.dueDate >= today && task.dueDate <= soonDate,
      ).length,
      statusBreakdown,
      upcomingTasks: byDueDate.filter((task) => task.dueDate >= today).slice(0, 5),
      recentTasks: [...tasks].slice(0, 5),
    }),
  );
});

router.get("/projects", async (_req, res): Promise<void> => {
  res.json(ListProjectsResponse.parse(await listProjectRows()));
});

router.post("/projects", async (req, res): Promise<void> => {
  const manager = await managerOnly(req, res);
  if (!manager) return;
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (toDateOnly(parsed.data.endDate) < toDateOnly(parsed.data.startDate)) {
    res.status(400).json({ error: "End date must be after the start date." });
    return;
  }
  const [project] = await db
    .insert(projectsTable)
    .values({
      ...parsed.data,
      startDate: toDateOnly(parsed.data.startDate),
      endDate: toDateOnly(parsed.data.endDate),
      createdById: manager.id,
    })
    .returning();
  const [projectDto] = await listProjectRows().then((rows) =>
    rows.filter((row) => row.id === project.id),
  );
  res.status(201).json(CreateProjectResponse.parse(projectDto));
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId))
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const [projectDto] = await listProjectRows().then((rows) =>
    rows.filter((row) => row.id === project.id),
  );
  const tasks = await listTaskRows(project.id);
  res.json(
    GetProjectResponse.parse({
      ...projectDto,
      description: project.description,
      tasks,
    }),
  );
});

router.patch("/projects/:projectId", async (req, res): Promise<void> => {
  const manager = await managerOnly(req, res);
  if (!manager) return;
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (
    parsed.data.startDate &&
    parsed.data.endDate &&
    toDateOnly(parsed.data.endDate) < toDateOnly(parsed.data.startDate)
  ) {
    res.status(400).json({ error: "End date must be after the start date." });
    return;
  }
  const { startDate, endDate, ...projectFields } = parsed.data;
  const projectUpdates: Partial<typeof projectsTable.$inferInsert> = {
    ...projectFields,
  };
  if (startDate) projectUpdates.startDate = toDateOnly(startDate);
  if (endDate) projectUpdates.endDate = toDateOnly(endDate);
  const [project] = await db
    .update(projectsTable)
    .set(projectUpdates)
    .where(eq(projectsTable.id, params.data.projectId))
    .returning();
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const [projectDto] = await listProjectRows().then((rows) =>
    rows.filter((row) => row.id === project.id),
  );
  res.json(UpdateProjectResponse.parse(projectDto));
});

router.delete("/projects/:projectId", async (req, res): Promise<void> => {
  const manager = await managerOnly(req, res);
  if (!manager) return;
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db
    .delete(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId))
    .returning();
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/tasks", async (req, res): Promise<void> => {
  const parsed = ListTasksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const tasks = await listTaskRows(parsed.data.projectId);
  res.json(ListTasksResponse.parse(tasks));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const manager = await managerOnly(req, res);
  if (!manager) return;
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.id, parsed.data.projectId))
    .limit(1);
  if (!project) {
    res.status(400).json({ error: "Choose an existing project." });
    return;
  }
  if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== null) {
    const [assignee] = await db
      .select({ id: officeMembersTable.id })
      .from(officeMembersTable)
      .where(eq(officeMembersTable.id, parsed.data.assigneeId))
      .limit(1);
    if (!assignee) {
      res.status(400).json({ error: "Choose an existing team member." });
      return;
    }
  }
  const [task] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tasksTable)
      .values({
        ...parsed.data,
        dueDate: toDateOnly(parsed.data.dueDate),
        createdById: manager.id,
      })
      .returning();
    await tx.insert(taskActivityTable).values({
      taskId: created.id,
      actorId: manager.id,
      actorName: manager.name,
      eventType: "created",
      oldValue: null,
      newValue: created.title,
    });
    if (created.assigneeId !== null) {
      const [assignee] = await tx
        .select({
          id: officeMembersTable.id,
          role: officeMembersTable.role,
        })
        .from(officeMembersTable)
        .where(eq(officeMembersTable.id, created.assigneeId))
        .limit(1);
      if (assignee?.role === "engineer") {
        await tx
          .insert(officeNotificationsTable)
          .values({
            memberId: assignee.id,
            taskId: created.id,
            type: "task_assigned",
            message: `تم تكليفك بالمهمة «${created.title}».`,
            dedupeKey: `task-assigned:${created.id}:created`,
          })
          .onConflictDoNothing();
      }
    }
    return [created];
  });
  const taskDto = (await listTaskRows()).find((row) => row.id === task.id);
  res.status(201).json(CreateTaskResponse.parse(taskDto));
});

router.get("/tasks/:taskId/discussion", async (req, res): Promise<void> => {
  const params = GetTaskDiscussionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const access = await requireTaskParticipant(req, res, params.data.taskId);
  if (!access) return;
  const [comments, activities] = await Promise.all([
    db
      .select()
      .from(taskCommentsTable)
      .where(eq(taskCommentsTable.taskId, params.data.taskId))
      .orderBy(desc(taskCommentsTable.createdAt), desc(taskCommentsTable.id)),
    db
      .select()
      .from(taskActivityTable)
      .where(eq(taskActivityTable.taskId, params.data.taskId))
      .orderBy(desc(taskActivityTable.createdAt), desc(taskActivityTable.id)),
  ]);
  res.json(GetTaskDiscussionResponse.parse({ comments, activities }));
});

router.post("/tasks/:taskId/comments", async (req, res): Promise<void> => {
  const params = CreateTaskCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const access = await requireTaskParticipant(req, res, params.data.taskId);
  if (!access) return;
  const parsed = CreateTaskCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data.body.trim();
  if (!body) {
    res.status(400).json({ error: "Comment cannot be empty." });
    return;
  }
  const [comment] = await db
    .insert(taskCommentsTable)
    .values({
      taskId: access.task.id,
      authorId: access.member.id,
      authorName: access.member.name,
      body,
    })
    .returning();
  res.status(201).json(CreateTaskCommentResponse.parse(comment));
});

router.patch("/tasks/:taskId", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const member = await requireMember(req, res);
  if (!member) return;
  const [existing] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, params.data.taskId))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  const canManage = await isConfiguredManager(req, member);
  if (!canManage) {
    const changesRestrictedFields =
      (parsed.data.title !== undefined &&
        parsed.data.title !== existing.title) ||
      (parsed.data.category !== undefined &&
        parsed.data.category !== existing.category) ||
      (parsed.data.priority !== undefined &&
        parsed.data.priority !== existing.priority) ||
      (parsed.data.assigneeId !== undefined &&
        parsed.data.assigneeId !== existing.assigneeId) ||
      (parsed.data.dueDate !== undefined &&
        toDateOnly(parsed.data.dueDate) !== existing.dueDate);
    if (existing.assigneeId !== member.id || changesRestrictedFields) {
      res.status(403).json({
        error: "Engineers can update progress and notes on their assigned tasks.",
      });
      return;
    }
  }
  if (
    parsed.data.assigneeId !== undefined &&
    parsed.data.assigneeId !== null
  ) {
    const [assignee] = await db
      .select({ id: officeMembersTable.id })
      .from(officeMembersTable)
      .where(eq(officeMembersTable.id, parsed.data.assigneeId))
      .limit(1);
    if (!assignee) {
      res.status(400).json({ error: "Choose an existing team member." });
      return;
    }
  }
  const { dueDate, ...taskFields } = parsed.data;
  const taskUpdates: Partial<typeof tasksTable.$inferInsert> = { ...taskFields };
  if (dueDate) taskUpdates.dueDate = toDateOnly(dueDate);
  const events: Array<{
    eventType: "status_changed" | "due_date_changed" | "assignee_changed";
    oldValue: string | null;
    newValue: string | null;
  }> = [];
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    events.push({
      eventType: "status_changed",
      oldValue: existing.status,
      newValue: parsed.data.status,
    });
  }
  if (dueDate && toDateOnly(dueDate) !== existing.dueDate) {
    events.push({
      eventType: "due_date_changed",
      oldValue: existing.dueDate,
      newValue: toDateOnly(dueDate),
    });
  }
  if (
    parsed.data.assigneeId !== undefined &&
    parsed.data.assigneeId !== existing.assigneeId
  ) {
    const assigneeIds = [existing.assigneeId, parsed.data.assigneeId].filter(
      (id): id is number => id !== null,
    );
    const assignees = assigneeIds.length
      ? await db
          .select({ id: officeMembersTable.id, name: officeMembersTable.name })
          .from(officeMembersTable)
          .where(inArray(officeMembersTable.id, assigneeIds))
      : [];
    const names = new Map(assignees.map((assignee) => [assignee.id, assignee.name]));
    events.push({
      eventType: "assignee_changed",
      oldValue: existing.assigneeId
        ? names.get(existing.assigneeId) ?? "عضو سابق"
        : "غير معيّن",
      newValue:
        parsed.data.assigneeId === null
          ? "غير معيّن"
          : names.get(parsed.data.assigneeId) ?? "عضو سابق",
    });
  }
  const [task] = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tasksTable)
      .set(taskUpdates)
      .where(eq(tasksTable.id, params.data.taskId))
      .returning();
    if (events.length) {
      await tx.insert(taskActivityTable).values(
        events.map((event) => ({
          taskId: updated.id,
          actorId: member.id,
          actorName: member.name,
          ...event,
        })),
      );
    }
    const notifications: Array<typeof officeNotificationsTable.$inferInsert> = [];
    const eventKey = updated.updatedAt.getTime();
    if (
      updated.assigneeId !== null &&
      updated.assigneeId !== existing.assigneeId
    ) {
      const [assignee] = await tx
        .select({
          id: officeMembersTable.id,
          role: officeMembersTable.role,
        })
        .from(officeMembersTable)
        .where(eq(officeMembersTable.id, updated.assigneeId))
        .limit(1);
      if (assignee?.role === "engineer") {
        notifications.push({
          memberId: assignee.id,
          taskId: updated.id,
          type: "task_assigned",
          message: `تم تكليفك بالمهمة «${updated.title}».`,
          dedupeKey: `task-assigned:${updated.id}:${eventKey}`,
        });
      }
    } else if (
      existing.status === "review" &&
      updated.status !== "review" &&
      updated.status !== "done" &&
      updated.assigneeId !== null
    ) {
      const [assignee] = await tx
        .select({
          id: officeMembersTable.id,
          role: officeMembersTable.role,
        })
        .from(officeMembersTable)
        .where(eq(officeMembersTable.id, updated.assigneeId))
        .limit(1);
      if (assignee?.role === "engineer") {
        notifications.push({
          memberId: assignee.id,
          taskId: updated.id,
          type: "task_returned",
          message: `أُعيدت إليك المهمة «${updated.title}» بعد المراجعة.`,
          dedupeKey: `task-returned:${updated.id}:${eventKey}`,
        });
      }
    }
    if (existing.status !== "review" && updated.status === "review") {
      const managerEmail = configuredManagerEmail();
      const managers = managerEmail
        ? await tx
            .select({ id: officeMembersTable.id })
            .from(officeMembersTable)
            .where(
              and(
                eq(officeMembersTable.role, "manager"),
                sql`lower(${officeMembersTable.email}) = ${managerEmail}`,
              ),
            )
        : [];
      for (const manager of managers) {
        notifications.push({
          memberId: manager.id,
          taskId: updated.id,
          type: "task_review",
          message: `وصلت المهمة «${updated.title}» إلى مرحلة المراجعة.`,
          dedupeKey: `task-review:${updated.id}:${eventKey}`,
        });
      }
    }
    if (notifications.length) {
      await tx
        .insert(officeNotificationsTable)
        .values(notifications)
        .onConflictDoNothing();
    }
    return [updated];
  });
  const taskDto = (await listTaskRows()).find((row) => row.id === task.id);
  res.json(UpdateTaskResponse.parse(taskDto));
});

router.delete("/tasks/:taskId", async (req, res): Promise<void> => {
  const manager = await managerOnly(req, res);
  if (!manager) return;
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [task] = await db
    .delete(tasksTable)
    .where(eq(tasksTable.id, params.data.taskId))
    .returning();
  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  res.sendStatus(204);
});

export default router;
