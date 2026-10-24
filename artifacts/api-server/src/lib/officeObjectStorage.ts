import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const officeObjectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

interface PrivateDirectory {
  bucketName: string;
  prefix: string;
}

function getPrivateDirectory(): PrivateDirectory {
  const rawDirectory = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!rawDirectory) {
    throw new Error("Private object storage is not configured.");
  }

  const parts = rawDirectory.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || parts.length === 0) {
    throw new Error("Private object storage path is invalid.");
  }
  return { bucketName, prefix: parts.join("/") };
}

function parsePrivateObjectPath(fullPath: string): {
  bucketName: string;
  objectName: string;
} {
  const parts = fullPath.replace(/^\/+/, "").split("/");
  const bucketName = parts.shift();
  const objectName = parts.join("/");
  if (!bucketName || !objectName) {
    throw new Error("Private object path is invalid.");
  }
  return { bucketName, objectName };
}

function getRelativePath(objectPath: string): string {
  if (!objectPath.startsWith("/objects/")) {
    throw new Error("Private object path is invalid.");
  }
  const relativePath = objectPath.slice("/objects/".length);
  if (
    !relativePath ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Private object path is invalid.");
  }
  return relativePath;
}

export async function createOfficeObjectUpload(): Promise<{
  uploadURL: string;
  objectPath: string;
}> {
  const directory = getPrivateDirectory();
  const objectName = `${directory.prefix}/office-attachments/${randomUUID()}`;
  const uploadURL = await signObjectURL({
    bucketName: directory.bucketName,
    objectName,
    method: "PUT",
    ttlSec: 900,
  });
  return {
    uploadURL,
    objectPath: `/objects/${objectName.slice(directory.prefix.length + 1)}`,
  };
}

export async function getOfficeObjectFile(objectPath: string): Promise<File> {
  const directory = getPrivateDirectory();
  const relativePath = getRelativePath(objectPath);
  const file = officeObjectStorageClient
    .bucket(directory.bucketName)
    .file(`${directory.prefix}/${relativePath}`);
  const [exists] = await file.exists();
  if (!exists) {
    throw new ObjectNotFoundError();
  }
  return file;
}

export async function deleteOfficeObject(objectPath: string): Promise<void> {
  const directory = getPrivateDirectory();
  const relativePath = getRelativePath(objectPath);
  const file = officeObjectStorageClient
    .bucket(directory.bucketName)
    .file(`${directory.prefix}/${relativePath}`);
  await file.delete({ ignoreNotFound: true });
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found.");
    this.name = "ObjectNotFoundError";
  }
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method,
        expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Could not generate an upload URL (${response.status}).`);
  }
  const result = (await response.json()) as { signed_url?: string };
  if (!result.signed_url) {
    throw new Error("Storage did not return an upload URL.");
  }
  return result.signed_url;
}
