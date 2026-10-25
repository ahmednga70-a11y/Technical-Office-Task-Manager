type Environment = Record<string, string | undefined>;

export function usesExternalClerk(env: Environment = process.env): boolean {
  return env.CLERK_AUTH_MODE === "external" || env.VERCEL === "1";
}

export function externalClerkConfiguration(env: Environment = process.env) {
  return {
    publishableKey: (
      env.CLERK_PUBLISHABLE_KEY ??
      env.VITE_CLERK_PUBLISHABLE_KEY
    )?.trim(),
    secretKey: env.CLERK_SECRET_KEY?.trim(),
  };
}

export function officeSignUpUrl(request: {
  protocol: string;
  headers: Record<string, string | string[] | undefined>;
}, env: Environment = process.env): string {
  const configured = env.APP_URL?.trim();
  if (configured) {
    const url = new URL(configured.endsWith("/") ? configured : `${configured}/`);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("APP_URL must be an HTTP(S) URL.");
    }
    return new URL("sign-up", url).toString();
  }
  if (usesExternalClerk(env)) {
    throw new Error("APP_URL must be configured for office invitations.");
  }
  const forwardedHost = request.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)
    ?.split(",")[0]?.trim() ?? request.headers.host;
  if (!host || Array.isArray(host)) throw new Error("Request host is missing.");
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const protocol = forwardedProtocol === "https" ? "https" : request.protocol;
  return new URL("/technical-office/sign-up", `${protocol}://${host}`).toString();
}
