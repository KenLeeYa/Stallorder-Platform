/**
 * Refuse to run responsive QA against any target outside its dedicated local lab.
 * @param {Record<string, string | undefined>} environment
 * @returns {void}
 */
export function assertResponsiveQaTarget(environment) {
  if (environment.RESPONSIVE_QA_RUN !== "true") {
    throw new Error("RESPONSIVE_QA_TARGET_INVALID: flag");
  }

  let app;
  let database;
  let primaryApi;
  try {
    app = new URL(environment.PLAYWRIGHT_APP_URL ?? "");
    database = new URL(environment.DATABASE_URL ?? "");
    primaryApi = new URL(environment.PRIMARY_SUPABASE_URL ?? "");
  } catch {
    throw new Error("RESPONSIVE_QA_TARGET_INVALID: missing or malformed URL");
  }

  if (app.href !== "http://127.0.0.1:3026/") {
    throw new Error("RESPONSIVE_QA_TARGET_INVALID: app");
  }
  if (environment.APP_BASE_URL && environment.APP_BASE_URL !== app.origin) {
    throw new Error("RESPONSIVE_QA_TARGET_INVALID: app base");
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol)
    || !["127.0.0.1", "localhost"].includes(database.hostname)
    || database.port !== "56822"
    || database.pathname !== "/postgres"
  ) {
    throw new Error("RESPONSIVE_QA_TARGET_INVALID: database");
  }
  if (primaryApi.href !== "http://127.0.0.1:56821/") {
    throw new Error("RESPONSIVE_QA_TARGET_INVALID: primary API");
  }
}
