export function officeProfileFailure(error: unknown): {
  status: number;
  code: string;
  error: string;
} {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const detail = current as { code?: unknown; cause?: unknown; status?: unknown; statusCode?: unknown };
    if (detail.code === "42P01" || detail.code === "42703") {
      return { status: 503, code: "OFFICE_DATABASE_SCHEMA_MISSING", error: "The office database schema is not ready." };
    }
    if (["28P01", "3D000", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(String(detail.code))) {
      return { status: 503, code: "OFFICE_DATABASE_UNAVAILABLE", error: "The office database is unavailable." };
    }
    if (detail.status === 429 || detail.statusCode === 429) {
      return { status: 503, code: "AUTH_PROVIDER_UNAVAILABLE", error: "The authentication provider is temporarily unavailable." };
    }
    current = detail.cause;
  }
  return { status: 500, code: "OFFICE_PROFILE_SYNC_FAILED", error: "The office profile could not be synchronized." };
}
