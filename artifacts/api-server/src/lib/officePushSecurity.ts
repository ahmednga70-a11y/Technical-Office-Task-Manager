import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PushSubscription } from "web-push";

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Push encryption is not configured");
  return createHash("sha256").update(`office-push:${secret}`).digest();
}

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export function encryptSubscription(subscription: PushSubscription): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(subscription), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSubscription(value: string): PushSubscription {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid push subscription");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8"));
}

export function isAllowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname;
    return value.length <= 2048 && url.protocol === "https:" && !url.username && !url.password
      && (!url.port || url.port === "443") && (
        host === "fcm.googleapis.com"
        || host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com")
        || host === "web.push.apple.com"
        || host.endsWith(".notify.windows.com")
      );
  } catch { return false; }
}
