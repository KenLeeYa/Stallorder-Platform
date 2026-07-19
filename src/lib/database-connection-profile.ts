export type SafeDatabaseConnectionProfile = {
  configured: boolean;
  validPostgresUrl: boolean;
  usesSupavisor: boolean;
  usesTransactionPort: boolean;
  disablesPreparedStatements: boolean;
  hasConnectionLimit: boolean;
};

export function inspectRuntimeDatabaseConnection(
  value = process.env.DATABASE_URL,
): SafeDatabaseConnectionProfile {
  const url = parsePostgresUrl(value);
  return {
    configured: Boolean(value?.trim()),
    validPostgresUrl: Boolean(url),
    usesSupavisor: Boolean(url?.hostname.endsWith(".pooler.supabase.com")),
    usesTransactionPort: Boolean(url && effectivePort(url) === 6543),
    disablesPreparedStatements: url?.searchParams.get("pgbouncer") === "true",
    hasConnectionLimit: Boolean(url?.searchParams.get("connection_limit")),
  };
}

export function inspectDirectDatabaseConnection(value = process.env.DIRECT_URL) {
  const url = parsePostgresUrl(value);
  return {
    configured: Boolean(value?.trim()),
    validPostgresUrl: Boolean(url),
    usesMigrationPort: Boolean(url && effectivePort(url) === 5432),
  };
}

function parsePostgresUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:" ? url : null;
  } catch {
    return null;
  }
}

function effectivePort(url: URL) {
  return url.port ? Number(url.port) : 5432;
}
