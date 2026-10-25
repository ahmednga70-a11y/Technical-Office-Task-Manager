import { createHash } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  officeAccountsTable,
  officeAuthLoginAttemptsTable,
  officeAuthSessionsTable,
  officeMembersTable,
} from "@workspace/db";
import {
  GetOfficeSessionResponse,
  LoginOfficeAccountBody,
  LoginOfficeAccountResponse,
} from "@workspace/api-zod";
import {
  clearOfficeSessionCookie,
  hashOfficeSessionToken,
  hashOfficePassword,
  newOfficeSessionToken,
  setOfficeSessionCookie,
  verifyOfficePassword,
} from "../lib/officePasswordAuth";

const router: IRouter = Router();
const MAX_LOGIN_FAILURES = 6;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 12;

function configuredManagerEmail(): string | undefined {
  const email = process.env.OFFICE_MANAGER_EMAIL?.trim().toLowerCase();
  return email || undefined;
}

function officeMemberDto(
  member: typeof officeMembersTable.$inferSelect,
  username: string,
) {
  return {
    id: member.id,
    clerkUserId: member.clerkUserId,
    username,
    name: member.name,
    email: member.email,
    role: member.role,
    createdAt: member.createdAt,
  };
}

async function bootstrapConfiguredManager(username: string): Promise<void> {
  const managerEmail = configuredManagerEmail();
  const initialPassword = process.env.OFFICE_MANAGER_INITIAL_PASSWORD;
  if (!managerEmail || username !== managerEmail) return;
  const [existingManagerAccount] = await db
    .select({ memberId: officeAccountsTable.memberId })
    .from(officeAccountsTable)
    .where(eq(officeAccountsTable.username, managerEmail))
    .limit(1);
  if (existingManagerAccount) return;
  if (!initialPassword) {
    throw new Error("The initial manager password is not configured.");
  }
  if (initialPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error("The initial manager password does not meet the minimum length.");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(98123452)`);
    const [accountByUsername] = await tx
      .select({ memberId: officeAccountsTable.memberId })
      .from(officeAccountsTable)
      .where(eq(officeAccountsTable.username, managerEmail))
      .limit(1);
    if (accountByUsername) return;

    const matchingMembers = await tx
      .select()
      .from(officeMembersTable)
      .where(sql`lower(${officeMembersTable.email}) = ${managerEmail}`)
      .limit(2);
    if (matchingMembers.length > 1) {
      throw new Error("Multiple office manager profiles match the configured email.");
    }
    let manager = matchingMembers[0];
    if (manager && manager.role !== "manager") {
      throw new Error("The configured manager profile has an unexpected role.");
    }
    if (!manager) {
      const [created] = await tx
        .insert(officeMembersTable)
        .values({
          clerkUserId: null,
          name: "مدير المكتب الفني",
          email: managerEmail,
          role: "manager",
        })
        .returning();
      manager = created;
    }
    const [accountForMember] = await tx
      .select({ memberId: officeAccountsTable.memberId })
      .from(officeAccountsTable)
      .where(eq(officeAccountsTable.memberId, manager.id))
      .limit(1);
    if (accountForMember) return;

    await tx.insert(officeAccountsTable).values({
      memberId: manager.id,
      username: managerEmail,
      passwordHash: await hashOfficePassword(initialPassword),
      isActive: true,
    });
  });
}

function loginRateKey(username: string, ip: string): string {
  return createHash("sha256")
    .update(`${username}\u0000${ip}`)
    .digest("hex");
}

async function isLoginLocked(usernameHash: string): Promise<boolean> {
  const [record] = await db
    .select({ lockedUntil: officeAuthLoginAttemptsTable.lockedUntil })
    .from(officeAuthLoginAttemptsTable)
    .where(eq(officeAuthLoginAttemptsTable.usernameHash, usernameHash))
    .limit(1);
  return Boolean(record?.lockedUntil && record.lockedUntil > new Date());
}

async function recordLoginFailure(usernameHash: string): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MS);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${usernameHash}), 98123453)`);
    const [existing] = await tx
      .select()
      .from(officeAuthLoginAttemptsTable)
      .where(eq(officeAuthLoginAttemptsTable.usernameHash, usernameHash))
      .limit(1);
    if (!existing) {
      await tx.insert(officeAuthLoginAttemptsTable).values({
        usernameHash,
        attemptCount: 1,
        windowStartedAt: now,
        lockedUntil: null,
      });
      return;
    }
    const withinWindow = existing.windowStartedAt > windowStart;
    const attemptCount = withinWindow ? existing.attemptCount + 1 : 1;
    await tx
      .update(officeAuthLoginAttemptsTable)
      .set({
        attemptCount,
        windowStartedAt: withinWindow ? existing.windowStartedAt : now,
        lockedUntil:
          attemptCount >= MAX_LOGIN_FAILURES
            ? new Date(now.getTime() + LOCKOUT_MS)
            : null,
      })
      .where(eq(officeAuthLoginAttemptsTable.usernameHash, usernameHash));
  });
}

router.post("/auth/login", async (req, res): Promise<void> => {
  if (process.env.OFFICE_AUTH_MODE !== "password") {
    res.status(404).json({ error: "Password sign-in is not enabled." });
    return;
  }
  const parsed = LoginOfficeAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const username = parsed.data.username.trim().toLowerCase();
  const rateKey = loginRateKey(username, req.ip || "unknown");
  if (await isLoginLocked(rateKey)) {
    res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again." });
    return;
  }

  try {
    await bootstrapConfiguredManager(username);
  } catch (error) {
    req.log.error({ err: error }, "Office manager account bootstrap failed");
    res.status(503).json({ error: "The manager account is not ready. Contact the system administrator." });
    return;
  }

  const [account] = await db
    .select({
      member: officeMembersTable,
      username: officeAccountsTable.username,
      passwordHash: officeAccountsTable.passwordHash,
      isActive: officeAccountsTable.isActive,
    })
    .from(officeAccountsTable)
    .innerJoin(
      officeMembersTable,
      eq(officeMembersTable.id, officeAccountsTable.memberId),
    )
    .where(eq(officeAccountsTable.username, username))
    .limit(1);
  const validPassword = await verifyOfficePassword(
    parsed.data.password,
    account?.passwordHash,
  );
  if (!account || !account.isActive || !validPassword) {
    await recordLoginFailure(rateKey);
    res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    return;
  }
  if (
    account.member.role === "manager" &&
    account.member.email.trim().toLowerCase() !== configuredManagerEmail()
  ) {
    res.status(403).json({ error: "حساب المدير غير معتمد لهذا التطبيق." });
    return;
  }

  await db
    .delete(officeAuthLoginAttemptsTable)
    .where(eq(officeAuthLoginAttemptsTable.usernameHash, rateKey));
  const { token, tokenHash } = newOfficeSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(officeAuthSessionsTable).values({
    tokenHash,
    memberId: account.member.id,
    expiresAt,
  });
  setOfficeSessionCookie(res, token);
  res.json(LoginOfficeAccountResponse.parse(
    officeMemberDto(account.member, account.username),
  ));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (process.env.OFFICE_AUTH_MODE !== "password") {
    res.status(404).json({ error: "Password sign-in is not enabled." });
    return;
  }
  if (!req.officeAuthMemberId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }
  const [account] = await db
    .select({ member: officeMembersTable, username: officeAccountsTable.username })
    .from(officeAccountsTable)
    .innerJoin(
      officeMembersTable,
      eq(officeMembersTable.id, officeAccountsTable.memberId),
    )
    .where(
      and(
        eq(officeAccountsTable.memberId, req.officeAuthMemberId),
        eq(officeAccountsTable.isActive, true),
      ),
    )
    .limit(1);
  if (!account) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }
  res.json(GetOfficeSessionResponse.parse(
    officeMemberDto(account.member, account.username),
  ));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  if (req.officeAuthSessionId) {
    await db
      .update(officeAuthSessionsTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(officeAuthSessionsTable.id, req.officeAuthSessionId),
          isNull(officeAuthSessionsTable.revokedAt),
        ),
      );
  }
  clearOfficeSessionCookie(res);
  res.sendStatus(204);
});

export default router;
