import { Router, type Request, type Response } from "express";
import { isConfiguredManager, requireMember } from "./office";
import { logger } from "../lib/logger";
import {
  createOfficeDriveAuthorizationUrl,
  createOfficeDriveOAuthState,
  finishOfficeDriveOAuth,
  getOfficeDriveConnection,
  isOfficeDriveOAuthConfigured,
  verifyOfficeDriveOAuthState,
} from "../lib/officeDriveStorage";

const router = Router();
const DRIVE_STATE_COOKIE = "office_drive_oauth_state";
const DRIVE_STATE_MAX_AGE_SECONDS = 10 * 60;

function secureCookie(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    return item.slice(separator + 1).trim();
  }
  return undefined;
}

function setDriveStateCookie(res: Response, state: string): void {
  res.setHeader(
    "Set-Cookie",
    `${DRIVE_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DRIVE_STATE_MAX_AGE_SECONDS}${secureCookie() ? "; Secure" : ""}`,
  );
}

function clearDriveStateCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${DRIVE_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie() ? "; Secure" : ""}`,
  );
}

function appUrl(): URL | undefined {
  try {
    const value = process.env.APP_URL?.trim();
    return value ? new URL(value) : undefined;
  } catch {
    return undefined;
  }
}

function dashboardRedirect(result: "connected" | "error"): string {
  const base = appUrl();
  if (!base) throw new Error("APP_URL is not configured.");
  const target = new URL("/dashboard", base);
  target.searchParams.set("drive", result);
  return target.toString();
}

router.get("/office/drive/status", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  const isManager = await isConfiguredManager(req, member);
  const storageMode = process.env.VERCEL === "1" ? "google_drive" : "replit";
  if (storageMode !== "google_drive") {
    res.json({
      storageMode,
      configured: false,
      connected: false,
      isManager,
      accountEmail: null,
    });
    return;
  }
  try {
    const connection = await getOfficeDriveConnection();
    res.json({
      storageMode,
      configured: isOfficeDriveOAuthConfigured(),
      connected: Boolean(connection),
      isManager,
      accountEmail: isManager ? (connection?.accountEmail ?? null) : null,
    });
  } catch (error) {
    logger.error({ err: error }, "Could not read office Drive connection status");
    res.status(503).json({
      error: "تعذّر قراءة إعداد تخزين الملفات.",
      code: "DRIVE_STORAGE_UNAVAILABLE",
    });
  }
});

router.post("/office/drive/connect", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!(await isConfiguredManager(req, member))) {
    res.status(403).json({ error: "ربط درايف متاح لمدير المكتب فقط." });
    return;
  }
  if (process.env.VERCEL !== "1") {
    res.status(409).json({
      error: "ربط درايف هذا مخصص لنسخة فيرسل.",
      code: "DRIVE_STORAGE_NOT_USED_HERE",
    });
    return;
  }
  if (!isOfficeDriveOAuthConfigured()) {
    res.status(503).json({
      error: "يلزم إعداد بيانات دخول جوجل للتطبيق أولًا.",
      code: "DRIVE_OAUTH_NOT_CONFIGURED",
    });
    return;
  }
  try {
    const state = createOfficeDriveOAuthState(member.id);
    const authorizationUrl = createOfficeDriveAuthorizationUrl(state);
    setDriveStateCookie(res, state);
    res.setHeader("Cache-Control", "no-store");
    res.json({ authorizationUrl });
  } catch (error) {
    logger.error({ err: error }, "Could not start office Drive connection");
    res.status(503).json({
      error: "تعذّر بدء ربط درايف. راجع إعدادات التطبيق وحاول مرة أخرى.",
    });
  }
});

router.get("/office/drive/oauth/callback", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!(await isConfiguredManager(req, member))) {
    clearDriveStateCookie(res);
    res.status(403).send("ربط درايف متاح لمدير المكتب فقط.");
    return;
  }

  const state = typeof req.query.state === "string" ? req.query.state : "";
  const cookieState = getCookie(req, DRIVE_STATE_COOKIE);
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const providerError =
    typeof req.query.error === "string" ? req.query.error : undefined;
  clearDriveStateCookie(res);

  if (
    providerError ||
    !state ||
    !cookieState ||
    state !== cookieState ||
    !verifyOfficeDriveOAuthState(state, member.id) ||
    !code
  ) {
    res.redirect(302, dashboardRedirect("error"));
    return;
  }

  try {
    await finishOfficeDriveOAuth(code, member.id);
    res.redirect(302, dashboardRedirect("connected"));
  } catch (error) {
    logger.error({ err: error }, "Google Drive connection callback failed");
    res.redirect(302, dashboardRedirect("error"));
  }
});

export default router;
