const accessToken = required("SUPABASE_ACCESS_TOKEN");
const primaryRef = required("PRIMARY_SUPABASE_PROJECT_REF");
const drRef = required("DR_SUPABASE_PROJECT_REF");
const appBaseUrl = new URL(required("APP_BASE_URL"));
if (appBaseUrl.protocol !== "https:") throw new Error("APP_BASE_URL_INVALID");

const headers = {
  authorization: `Bearer ${accessToken}`,
  "content-type": "application/json",
};

try {
  requireApproval();
  const [primarySecrets, drAuth] = await Promise.all([
    management(`/v1/projects/${primaryRef}/secrets`),
    management(`/v1/projects/${drRef}/config/auth`),
  ]);
  const secretNames = [
    "ABUSE_HASH_SECRET",
    "TOKEN_DERIVATION_SECRET",
    "TURNSTILE_SECRET_KEY",
  ];
  const synchronized = secretNames.map((name) => {
    const value = primarySecrets.find((secret) => secret.name === name)?.value;
    if (!value) throw new Error(`PRIMARY_EDGE_SECRET_MISSING_${name}`);
    return { name, value };
  });
  const primaryOrigins = primarySecrets.find(
    (secret) => secret.name === "PUBLIC_APP_ORIGINS",
  )?.value;
  synchronized.push(
    {
      name: "PUBLIC_APP_ORIGINS",
      value: primaryOrigins
        || `${appBaseUrl.origin},https://stallorder-platform.vercel.app`,
    },
    { name: "APP_ENV", value: "production" },
    { name: "TURNSTILE_EXPECTED_HOSTNAME", value: appBaseUrl.hostname },
    { name: "TURNSTILE_ALLOW_TEST_KEYS", value: "false" },
    { name: "TRUSTED_CLIENT_IP_HEADER", value: "cf-connecting-ip" },
  );

  await management(`/v1/projects/${drRef}/secrets`, {
    method: "POST",
    body: JSON.stringify(synchronized),
  });

  if (
    drAuth.external_google_enabled !== true
    || !drAuth.external_google_client_id
    || !drAuth.external_google_secret
  ) {
    throw new Error("DR_GOOGLE_AUTH_NOT_CONFIGURED");
  }
  await management(`/v1/projects/${drRef}/config/auth`, {
    method: "PATCH",
    body: JSON.stringify({
      site_url: appBaseUrl.origin,
      uri_allow_list: [
        `${appBaseUrl.origin}/auth/callback`,
        `${appBaseUrl.origin}/invite/claim`,
      ].join(","),
    }),
  });
  await management(`/v1/projects/${drRef}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "stallorder-dr" }),
  });

  console.log(JSON.stringify({
    event: "production_dr_project_configured",
    drProjectRef: drRef,
    projectName: "stallorder-dr",
    authSiteUrl: appBaseUrl.origin,
    googleAuthConfigured: true,
    synchronizedSecretNames: synchronized.map((secret) => secret.name),
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    event: "production_dr_project_configuration_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
}

async function management(path, init = {}) {
  const response = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`SUPABASE_MANAGEMENT_API_${response.status}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function requireApproval() {
  if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
    throw new Error("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
  }
  if (process.env.DR_CHANGE_CONFIRMATION !== "CONFIGURE_PRODUCTION_DR_PROJECT") {
    throw new Error("CONFIRMATION_REQUIRED_CONFIGURE_PRODUCTION_DR_PROJECT");
  }
}
