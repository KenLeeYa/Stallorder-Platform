import { appendFile } from "node:fs/promises";

const output = required("GITHUB_ENV");
const primaryRef = projectRef("PRIMARY_SUPABASE_PROJECT_REF");
const drRef = projectRef("DR_SUPABASE_PROJECT_REF");

try {
  const primaryDirectUrl = poolerUrl(
    primaryRef,
    required("SUPABASE_DB_PASSWORD"),
    5432,
    false,
  );
  const drDirectUrl = poolerUrl(
    drRef,
    required("DR_SUPABASE_DB_PASSWORD"),
    5432,
    false,
  );
  const drRuntimeUrl = poolerUrl(
    drRef,
    required("DR_SUPABASE_DB_PASSWORD"),
    6543,
    true,
  );
  const replicationUrl = postgresUrl({
    username: "stallorder_replication",
    password: required("PRIMARY_REPLICATION_PASSWORD"),
    hostname: `db.${primaryRef}.supabase.co`,
    port: 5432,
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
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_database_url_export_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
}

function poolerUrl(ref, password, port, transactionMode) {
  return postgresUrl({
    username: `postgres.${ref}`,
    password,
    hostname: "aws-0-ap-northeast-1.pooler.supabase.com",
    port,
    search: transactionMode
      ? {
          pgbouncer: "true",
          connection_limit: "5",
          pool_timeout: "20",
          sslmode: "require",
        }
      : {
          sslmode: "require",
          connect_timeout: "10",
        },
  });
}

function postgresUrl({ username, password, hostname, port, search }) {
  const url = new URL("postgresql://placeholder.invalid");
  url.username = username;
  url.password = password;
  url.hostname = hostname;
  url.port = String(port);
  url.pathname = "/postgres";
  for (const [name, value] of Object.entries(search)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
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
