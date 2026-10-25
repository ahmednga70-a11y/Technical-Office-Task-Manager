import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  officeAccountsTable,
  officeAuthSessionsTable,
  officeMembersTable,
} from "@workspace/db";

const COOKIE_NAME = "office_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
declare global {
  namespace Express {
    interface Request {
      officeAuthMemberId?: number;
      officeAuthSessionId?: number;
    }
  }
}

function deriveKey(password: string, salt: string, length = KEY_LENGTH): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashOfficePassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await deriveKey(password, salt);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

export async function verifyOfficePassword(
  password: string,
  encoded: string | undefined,
): Promise<boolean> {
  const [algorithm, salt, expectedHex] = encoded?.split("$") ?? [];
  if (
    algorithm !== "scrypt" ||
    !salt ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !expectedHex ||
    !/^[a-f0-9]{128}$/.test(expectedHex)
  ) {
    await deriveKey(password, "office-auth-dummy-salt");
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await deriveKey(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newOfficeSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashOfficeSessionToken(token) };
}

export function hashOfficeSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    const value = item.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{40,64}$/.test(value) ? value : undefined;
  }
  return undefined;
}

export function setOfficeSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`,
  );
}

export function clearOfficeSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
  );
}

export async function officePasswordSessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.path === "/auth/login") {
    next();
    return;
  }
  const token = getCookie(req.headers.cookie, COOKIE_NAME);
  if (!token) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }
  try {
    const [session] = await db
      .select({
        sessionId: officeAuthSessionsTable.id,
        memberId: officeMembersTable.id,
      })
      .from(officeAuthSessionsTable)
      .innerJoin(
        officeAccountsTable,
        eq(officeAccountsTable.memberId, officeAuthSessionsTable.memberId),
      )
      .innerJoin(
        officeMembersTable,
        eq(officeMembersTable.id, officeAuthSessionsTable.memberId),
      )
      .where(
        and(
          eq(officeAuthSessionsTable.tokenHash, hashOfficeSessionToken(token)),
          isNull(officeAuthSessionsTable.revokedAt),
          gt(officeAuthSessionsTable.expiresAt, new Date()),
          eq(officeAccountsTable.isActive, true),
        ),
      )
      .limit(1);
    if (!session) {
      clearOfficeSessionCookie(res);
      res.status(401).json({ error: "Session expired. Sign in again." });
      return;
    }
    req.officeAuthMemberId = session.memberId;
    req.officeAuthSessionId = session.sessionId;
    next();
  } catch (error) {
    next(error);
  }
}
