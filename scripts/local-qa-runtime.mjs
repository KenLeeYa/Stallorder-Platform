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

  const origin = `http://127.0.0.1:${port}`;
  return {
    ...environment,
    NODE_ENV: "development",
    APP_BASE_URL: origin,
    NEXT_PUBLIC_APP_URL: origin,
    PUBLIC_ORDER_FUNCTION_ORIGIN: origin,
    LOCAL_DEV_ALLOWED_ORIGINS: origin,
    LOCAL_QA_QUICK_LOGIN_ENABLED: "true",
    LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT: "true",
    NEXT_PUBLIC_ENABLE_PWA_IN_DEVELOPMENT: "false",
    NEXT_PUBLIC_FORCE_PUBLIC_ORDER_CIRCUIT_B: "true",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  };
}

function isLoopbackDatabaseUrl(value) {
  if (!value) return false;
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
