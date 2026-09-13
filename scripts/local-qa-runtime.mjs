const DEFAULT_LOCAL_QA_PORT = 3012;

export function parseLocalQaPort(args, defaultPort = DEFAULT_LOCAL_QA_PORT) {
  const equalsArgument = args.find((argument) => argument.startsWith("--port="));
  const flagIndex = args.indexOf("--port");
  const raw = equalsArgument?.slice("--port=".length)
    ?? (flagIndex >= 0 ? args[flagIndex + 1] : String(defaultPort));
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("LOCAL_QA_PORT_INVALID");
  }
  return port;
}

export function buildLocalQaEnvironment(port, environment = process.env) {
  if (
    environment.NODE_ENV === "production"
    || environment.APP_ENV === "production"
    || environment.VERCEL_ENV === "production"
  ) {
    throw new Error("LOCAL_QA_PRODUCTION_MODE_BLOCKED");
  }
  if (!isLoopbackDatabaseUrl(environment.DATABASE_URL)) {
    throw new Error("LOCAL_QA_DATABASE_MUST_BE_LOOPBACK");
  }

  // A local database alone does not isolate Auth, Storage, Edge or dispatch.
  for (const [key, value] of Object.entries(environment)) {
    if (!value || !/(?:^|_)(?:URLS?|ORIGINS?|HOST|ENDPOINT)$/.test(key)) continue;
    for (const destination of value.split(",").map((item) => item.trim()).filter(Boolean)) {
      try {
        const url = new URL(destination.includes("://") ? destination : `https://${destination}`);
        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          || !["http:", "https:", "ws:", "wss:", "postgres:", "postgresql:"].includes(url.protocol)) {
          throw new Error("external");
        }
      } catch {
        // Name only: URLs can contain credentials and personal data.
        throw new Error(`LOCAL_QA_EXTERNAL_DESTINATION:${key}`);
      }
    }
  }

  const systemKey = /^(path|systemroot|windir|temp|tmp|userprofile|appdata|localappdata|programfiles(?:\(x86\))?|comspec|pathext|number_of_processors)$/i;
  const localKeys = new Set([
    "DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL",
    "NEXT_PUBLIC_SUPABASE_REALTIME_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ABUSE_HASH_SECRET", "TOKEN_DERIVATION_SECRET",
    "AUDIT_IP_HASH_SECRET", "SESSION_FINGERPRINT_HASH_SECRET", "OAUTH_STATE_SECRET", "OFFLINE_PERMIT_SIGNING_SECRET",
    "PAYMENT_MOCK_WEBHOOK_SECRET", "DELIVERY_MOCK_WEBHOOK_SECRET", "TURNSTILE_SECRET_KEY", "TURNSTILE_ALLOW_TEST_KEYS",
    "ATTENDANCE_CHALLENGE_SECRET", "NEXT_TELEMETRY_DISABLED", "COMPLIANCE_ENABLED", "COMPLIANCE_FIELD_KEY",
    "COMPLIANCE_FIELD_KEYS", "COMPLIANCE_ACTIVE_KEY_ID", "COMPLIANCE_SUBJECT_KEY",
  ]);
  const isolated = Object.fromEntries(Object.entries(environment).filter(([key]) => systemKey.test(key) || localKeys.has(key)));

  const origin = `http://127.0.0.1:${port}`;
  return {
    ...isolated,
    NODE_ENV: "development",
    APP_ENV: "development",
    EXTERNAL_DISPATCH_ENABLED: "false",
    OAUTH_PROVIDER_MODE: "mock",
    EINVOICE_DEV_MODE: "true",
    EINVOICE_PRODUCTION_ISSUE_ENABLED: "false",
    BACKEND_ACTIVE_TARGET: "PRIMARY",
    FRONTEND_BASE_URL: origin,
    PUBLIC_APP_ORIGINS: origin,
    APP_BASE_URL: origin,
    NEXT_PUBLIC_APP_URL: origin,
    PUBLIC_ORDER_FUNCTION_ORIGIN: origin,
    LOCAL_DEV_ALLOWED_ORIGINS: origin,
    LOCAL_QA_QUICK_LOGIN_ENABLED: "true",
    LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT: "true",
    REPORT_DELIVERY_MODE: "simulate",
    PAYMENT_PROVIDER_MODE: "mock",
    NEXT_PUBLIC_ENABLE_PWA_IN_DEVELOPMENT: environment.LOCAL_QA_ENABLE_WEB_PUSH === "true" ? "true" : "false",
    NEXT_PUBLIC_FORCE_PUBLIC_ORDER_CIRCUIT_B: "true",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  };
}

function isLoopbackDatabaseUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}
