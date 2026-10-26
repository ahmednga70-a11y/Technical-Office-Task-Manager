import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { db, officeDriveConnectionsTable } from "@workspace/db";

const DRIVE_API = "https://www.googleapis.com";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export type OfficeDriveConnection =
  typeof officeDriveConnectionsTable.$inferSelect;

export interface OfficeDriveFileMetadata {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
}

export class OfficeDriveNotConfiguredError extends Error {
  constructor() {
    super("Google Drive OAuth is not configured.");
    this.name = "OfficeDriveNotConfiguredError";
  }
}

export class OfficeDriveNotConnectedError extends Error {
  constructor() {
    super("Google Drive has not been connected by the office manager.");
    this.name = "OfficeDriveNotConnectedError";
  }
}

export class OfficeDriveFileNotFoundError extends Error {
  constructor() {
    super("Office Drive file not found.");
    this.name = "OfficeDriveFileNotFoundError";
  }
}

function sessionSecret(): string {
  const value = process.env.SESSION_SECRET?.trim();
  if (!value) throw new Error("SESSION_SECRET is not configured.");
  return value;
}

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update(`technical-office-drive-token:${sessionSecret()}`)
    .digest();
}

function encryptRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptRefreshToken(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Stored Google Drive credentials are invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function googleOAuthConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  const appUrl = process.env.APP_URL?.trim();
  if (!clientId || !clientSecret || !appUrl) {
    throw new OfficeDriveNotConfiguredError();
  }

  let origin: URL;
  try {
    origin = new URL(appUrl);
  } catch {
    throw new Error("APP_URL is invalid.");
  }
  if (process.env.VERCEL === "1" && origin.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS on Vercel.");
  }

  return {
    clientId,
    clientSecret,
    redirectUri: new URL("/api/office/drive/oauth/callback", origin).toString(),
  };
}

export function isOfficeDriveOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() &&
      process.env.APP_URL?.trim(),
  );
}

function oauthClient(): OAuth2Client {
  const config = googleOAuthConfig();
  return new OAuth2Client(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

export function createOfficeDriveOAuthState(memberId: number): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(18).toString("base64url");
  const payload = `${memberId}.${issuedAt}.${nonce}`;
  const signature = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOfficeDriveOAuthState(
  state: string,
  memberId: number,
): boolean {
  const [memberValue, issuedAtValue, nonce, signature, extra] = state.split(".");
  if (extra || !memberValue || !issuedAtValue || !nonce || !signature) {
    return false;
  }
  const stateMemberId = Number(memberValue);
  const issuedAt = Number(issuedAtValue);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(stateMemberId) ||
    stateMemberId !== memberId ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + 30 ||
    now - issuedAt > OAUTH_STATE_MAX_AGE_SECONDS
  ) {
    return false;
  }
  const payload = `${memberValue}.${issuedAtValue}.${nonce}`;
  const expected = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createOfficeDriveAuthorizationUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: ["openid", "email", DRIVE_FILE_SCOPE],
    state,
  });
}

export async function getOfficeDriveConnection(): Promise<
  OfficeDriveConnection | undefined
> {
  const [connection] = await db
    .select()
    .from(officeDriveConnectionsTable)
    .where(eq(officeDriveConnectionsTable.provider, "google-drive"))
    .limit(1);
  return connection;
}

async function oauthAccessToken(client: OAuth2Client): Promise<string> {
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result.token;
  if (!token) throw new Error("Google did not return an access token.");
  return token;
}

async function fetchDriveApi(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${DRIVE_API}${path}`, { ...init, headers });
}

async function driveJson<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchDriveApi(accessToken, path, init);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Google Drive request failed (${response.status}): ${detail}`,
    );
  }
  return (await response.json()) as T;
}

async function createPrivateDriveFolder(
  accessToken: string,
): Promise<string> {
  const result = await driveJson<{ id?: string }>(
    accessToken,
    "/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "فريق المكتب الفني - مرفقات",
        mimeType: "application/vnd.google-apps.folder",
      }),
    },
  );
  if (!result.id) throw new Error("Google Drive did not create a folder.");
  return result.id;
}

async function getGoogleAccountEmail(accessToken: string): Promise<string> {
  const result = await driveJson<{ email?: string }>(
    accessToken,
    "/oauth2/v3/userinfo",
  );
  const email = result.email?.trim().toLowerCase();
  if (!email) throw new Error("Google did not return an account email.");
  return email;
}

export async function finishOfficeDriveOAuth(
  code: string,
  connectedById: number,
): Promise<{ accountEmail: string }> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("Google did not return an access token.");
  }
  client.setCredentials(tokens);
  const accessToken = await oauthAccessToken(client);
  const accountEmail = await getGoogleAccountEmail(accessToken);

  const existing = await getOfficeDriveConnection();
  const refreshToken =
    tokens.refresh_token ??
    (existing
      ? decryptRefreshToken(existing.refreshTokenCiphertext)
      : undefined);
  if (!refreshToken) {
    throw new Error("Google did not return a refresh token.");
  }
  const folderId =
    existing?.accountEmail.toLowerCase() === accountEmail
      ? existing.folderId
      : await createPrivateDriveFolder(accessToken);

  await db
    .insert(officeDriveConnectionsTable)
    .values({
      provider: "google-drive",
      accountEmail,
      refreshTokenCiphertext: encryptRefreshToken(refreshToken),
      folderId,
      connectedById,
    })
    .onConflictDoUpdate({
      target: officeDriveConnectionsTable.provider,
      set: {
        accountEmail,
        refreshTokenCiphertext: encryptRefreshToken(refreshToken),
        folderId,
        connectedById,
        updatedAt: new Date(),
      },
    });

  return { accountEmail };
}

async function connectedDriveAccess(): Promise<{
  accessToken: string;
  connection: OfficeDriveConnection;
}> {
  const connection = await getOfficeDriveConnection();
  if (!connection) throw new OfficeDriveNotConnectedError();
  const client = oauthClient();
  client.setCredentials({
    refresh_token: decryptRefreshToken(connection.refreshTokenCiphertext),
  });
  return {
    accessToken: await oauthAccessToken(client),
    connection,
  };
}

export async function createOfficeDriveUploadSession(input: {
  attachmentId: number;
  fileName: string;
  contentType: string;
  size: number;
}): Promise<string> {
  const { accessToken, connection } = await connectedDriveAccess();
  const query = new URLSearchParams({
    uploadType: "resumable",
    fields: "id,name,size,mimeType,parents,appProperties,trashed",
  });
  const response = await fetchDriveApi(
    accessToken,
    `/upload/drive/v3/files?${query.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.contentType,
        "X-Upload-Content-Length": String(input.size),
      },
      body: JSON.stringify({
        name: input.fileName,
        mimeType: input.contentType,
        parents: [connection.folderId],
        appProperties: {
          officeAttachmentId: String(input.attachmentId),
        },
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Could not start a Google Drive upload (${response.status}): ${detail}`,
    );
  }
  const uploadUrl = response.headers.get("location");
  if (!uploadUrl || !uploadUrl.startsWith("https://")) {
    throw new Error("Google Drive did not return a secure upload URL.");
  }
  return uploadUrl;
}

export async function getOfficeDriveFileMetadata(
  fileId: string,
): Promise<OfficeDriveFileMetadata> {
  const { accessToken } = await connectedDriveAccess();
  const query = new URLSearchParams({
    fields: "id,name,size,mimeType,parents,appProperties,trashed",
  });
  const response = await fetchDriveApi(
    accessToken,
    `/drive/v3/files/${encodeURIComponent(fileId)}?${query.toString()}`,
  );
  if (response.status === 404) throw new OfficeDriveFileNotFoundError();
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Google Drive request failed (${response.status}): ${detail}`,
    );
  }
  return (await response.json()) as OfficeDriveFileMetadata;
}

export async function getOfficeDriveFileContent(
  fileId: string,
): Promise<Response> {
  const { accessToken } = await connectedDriveAccess();
  const response = await fetchDriveApi(
    accessToken,
    `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  if (response.status === 404) {
    throw new OfficeDriveFileNotFoundError();
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Could not download a Google Drive file (${response.status}): ${detail}`,
    );
  }
  return response;
}

export async function deleteOfficeDriveFile(fileId: string): Promise<void> {
  const { accessToken } = await connectedDriveAccess();
  const response = await fetchDriveApi(
    accessToken,
    `/drive/v3/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
  if (response.status === 404) return;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Could not delete a Google Drive file (${response.status}): ${detail}`,
    );
  }
}

export function officeDriveFilePath(fileId: string): string {
  return `drive:${fileId}`;
}

export function officeDrivePendingPath(): string {
  return `drive-pending:${randomUUID()}`;
}

export function parseOfficeDriveFilePath(
  objectPath: string,
): string | undefined {
  const match = /^drive:([A-Za-z0-9_-]{10,200})$/.exec(objectPath);
  return match?.[1];
}

export function isOfficeDrivePendingPath(objectPath: string): boolean {
  return /^drive-pending:[A-Za-z0-9_-]{16,64}$/.test(objectPath);
}
