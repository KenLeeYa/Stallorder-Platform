export function localLinePreviewAllowed(environment: { APP_ENV?: string; VERCEL_ENV?: string; VERCEL?: string; DATABASE_URL?: string; RESPONSIVE_QA_RUN?: string; APP_BASE_URL?: string }) {
  if (environment.VERCEL) return false;
  try {
    const database = new URL(environment.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) return false;
    if (environment.APP_ENV === "local" && !environment.VERCEL_ENV) return true;
    return environment.APP_ENV === "test" && environment.VERCEL_ENV === "preview" && environment.RESPONSIVE_QA_RUN === "true"
      && environment.APP_BASE_URL === "http://127.0.0.1:3026" && database.hostname === "127.0.0.1" && database.port === "56822" && database.pathname === "/postgres";
  } catch { return false; }
}
