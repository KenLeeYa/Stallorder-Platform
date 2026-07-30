import { appendFile } from "node:fs/promises";

const output = required("GITHUB_ENV");
const primaryRef = projectRef("PRIMARY_SUPABASE_PROJECT_REF");
const drRef = projectRef("DR_SUPABASE_PROJECT_REF");

try {
  const accessToken = required("SUPABASE_ACCESS_TOKEN");
  const temporaryAccessExpiresAt = await ensureTemporaryAccess(
    primaryRef,
    accessToken,
  );
  const [primaryConnection, drConnection] = await Promise.all([
    discoverConnection(primaryRef, accessToken),
    discoverConnection(drRef, accessToken),
  ]);
  const primaryDirectUrl = poolerUrl(
    primaryConnection,
    accessToken,
    5432,
    false,
    true,
  );
  const drDirectUrl = poolerUrl(
    drConnection,
    required("DR_SUPABASE_DB_PASSWORD"),
    5432,
    false,
    false,
  );
  const drRuntimeUrl = poolerUrl(
    drConnection,
    required("DR_SUPABASE_DB_PASSWORD"),
    drConnection.transactionPort,
    true,
    false,
  );
  const replicationUrl = postgresUrl({
    username: "stallorder_replication",
    password: required("PRIMARY_REPLICATION_PASSWORD"),
    hostname: primaryConnection.databaseHost,
    port: 5432,
    database: "postgres",
    search: {
      sslmode: "require",
      connect_timeout: "10",
    },
  });
  const values = {
    DIRECT_URL: primaryDirectUrl,
    DR_DIRECT_URL: drDirectUrl,
    DR_RUNTIME_DATABASE_URL: drRuntimeUrl,
    PRIMARY_REPLICATION_URL: replicationUrl,
  };
  for (const value of Object.values(values)) {
    console.log(`::add-mask::${value}`);
  }
  await appendFile(
    output,
    Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n") + "\n",
    { encoding: "utf8" },
  );
  console.log(JSON.stringify({
    event: "dr_database_urls_exported",
    variableNames: Object.keys(values),
    endpointsDiscoveredFromManagementApi: true,
    primaryTemporaryAccessExpiresAt: temporaryAccessExpiresAt,
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_database_url_export_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
}

async function ensureTemporaryAccess(ref, accessToken) {
  const profile = await managementApi(
    "/v1/profile",
    accessToken,
    {},
    "profile",
  );
  const userId = profile?.gotrue_id;
  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new Error("SUPABASE_PROFILE_ID_INVALID");
  }

  const status = await managementApi(
    `/v1/projects/${ref}/jit-access`,
    accessToken,
    {},
    "temporary_access_status",
  );
  if (status?.state !== "enabled") {
    const enabled = await managementApi(
      `/v1/projects/${ref}/jit-access`,
      accessToken,
      {
        method: "PUT",
        body: JSON.stringify({ state: "enabled" }),
      },
      "temporary_access_enable",
    );
    if (enabled?.state !== "enabled" || enabled?.appliedSuccessfully === false) {
      throw new Error("SUPABASE_TEMPORARY_ACCESS_ENABLE_FAILED");
    }
  }

  const mappings = await managementApi(
    `/v1/projects/${ref}/database/jit/list`,
    accessToken,
    {},
    "jit_mapping_list",
  );
  const current = Array.isArray(mappings?.items)
    ? mappings.items.find((item) => item?.user_id === userId)
    : null;
  const currentRoles = Array.isArray(current?.user_roles)
    ? current.user_roles
    : [];
  const existingPostgres = currentRoles.find(
    (entry) => entry?.role === "postgres",
  );
  const expiresAt = Math.floor(Date.now() / 1_000) + 2 * 60 * 60;
  const postgresRole = {
    ...(existingPostgres && typeof existingPostgres === "object"
      ? existingPostgres
      : {}),
    role: "postgres",
    expires_at: expiresAt,
  };
  const userRoles = [
    ...currentRoles.filter((entry) => entry?.role !== "postgres"),
    postgresRole,
  ];
  const updated = await managementApi(
    `/v1/projects/${ref}/database/jit`,
    accessToken,
    {
      method: "PUT",
      body: JSON.stringify({
        user_id: userId,
        roles: userRoles,
      }),
    },
    "jit_mapping_update",
  );
  if (
    updated?.user_id !== userId ||
    !Array.isArray(updated?.user_roles) ||
    !updated.user_roles.some((entry) => entry?.role === "postgres")
  ) {
    throw new Error("SUPABASE_TEMPORARY_ACCESS_MAPPING_FAILED");
  }
  return new Date(expiresAt * 1_000).toISOString();
}

async function discoverConnection(ref, accessToken) {
  const [poolerConfig, project] = await Promise.all([
    managementApi(
      `/v1/projects/${ref}/config/database/pooler`,
      accessToken,
      {},
      "pooler_config",
    ),
    managementApi(
      `/v1/projects/${ref}`,
      accessToken,
      {},
      "project_details",
    ),
  ]);
  if (!Array.isArray(poolerConfig) || poolerConfig.length === 0) {
    throw new Error(`POOLER_CONFIG_MISSING_${ref}`);
  }
  const primary =
    poolerConfig.find((entry) => entry?.database_type === "PRIMARY") ??
    poolerConfig[0];
  const connectionString =
    primary?.connection_string ?? primary?.connectionString;
  if (typeof connectionString !== "string") {
    throw new Error(`POOLER_CONNECTION_STRING_MISSING_${ref}`);
  }

  const template = parsePostgresUrl(connectionString, `POOLER_${ref}`);
  const databaseHost = project?.database?.host;
  if (databaseHost !== `db.${ref}.supabase.co`) {
    throw new Error(`DATABASE_HOST_INVALID_${ref}`);
  }
  if (
    !template.hostname.endsWith(".pooler.supabase.com") ||
    decodeURIComponent(template.username) !== `postgres.${ref}`
  ) {
    throw new Error(`POOLER_ENDPOINT_INVALID_${ref}`);
  }
  const transactionPort = Number(template.port || primary?.db_port);
  if (
    !Number.isInteger(transactionPort) ||
    transactionPort < 1 ||
    transactionPort > 65_535
  ) {
    throw new Error(`POOLER_PORT_INVALID_${ref}`);
  }

  return {
    database: template.pathname.replace(/^\/+/, "") || "postgres",
    databaseHost,
    poolerHost: template.hostname,
    poolerUsername: decodeURIComponent(template.username),
    transactionPort,
  };
}

async function managementApi(
  path,
  accessToken,
  init = {},
  operation = "request",
) {
  const response = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `SUPABASE_MANAGEMENT_API_${operation.toUpperCase()}_${response.status}`,
    );
  }
  return response.json();
}

function poolerUrl(
  connection,
  password,
  port,
  transactionMode,
  temporaryAccess,
) {
  const search = transactionMode
    ? {
        pgbouncer: "true",
        connection_limit: "5",
        pool_timeout: "20",
        sslmode: "require",
      }
    : {
        sslmode: "require",
        connect_timeout: "10",
      };
  if (temporaryAccess) search.options = "-c jit=true";
  const url = postgresUrl({
    username: connection.poolerUsername,
    password,
    hostname: connection.poolerHost,
    port,
    database: connection.database,
    search,
  });
  if (!temporaryAccess) return url;

  const formEncodedOptions = "options=-c+jit%3Dtrue";
  if (!url.includes(formEncodedOptions)) {
    throw new Error("JIT_OPTIONS_ENCODING_FAILED");
  }
  return url.replace(
    formEncodedOptions,
    "options=-c%20jit%3Dtrue",
  );
}

function postgresUrl({ username, password, hostname, port, database, search }) {
  const url = new URL("postgresql://placeholder.invalid");
  url.username = username;
  url.password = password;
  url.hostname = hostname;
  url.port = String(port);
  url.pathname = `/${database}`;
  for (const [name, value] of Object.entries(search)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

function parsePostgresUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name}_INVALID`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${name}_INVALID`);
  }
  return url;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || /[\r\n]/.test(value)) throw new Error(`${name}_MISSING_OR_INVALID`);
  return value;
}

function projectRef(name) {
  const value = required(name);
  if (!/^[a-z]{20}$/.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}
