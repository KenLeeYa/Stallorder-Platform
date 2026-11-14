import assert from 'node:assert/strict';

export function nativeReadFailure(error) {
  // stderr can contain connection details. Match only fixed categories and
  // discard the original bytes, message, stack and cause from public output.
  const stderr=Buffer.isBuffer(error?.stderr)?error.stderr.toString('utf8'):error?.stderr;
  if(typeof stderr==='string'&&Buffer.byteLength(stderr)<=128*1024) {
    if(/password authentication failed/i.test(stderr))return 'DELIVERY_EXECUTOR_AUTH_REJECTED';
    if(/permission denied/i.test(stderr))return 'DELIVERY_EXECUTOR_PERMISSION_REJECTED';
    if(/unsupported startup parameter/i.test(stderr))return 'DELIVERY_EXECUTOR_STARTUP_REJECTED';
    if(/connection timed out|connection refused|could not translate host name|network is unreachable/i.test(stderr))return 'DELIVERY_EXECUTOR_CONNECTION_FAILED';
  }
  return 'DELIVERY_EXECUTOR_QUERY_FAILED';
}

// Shared fixed libpq settings for native read-only collectors. Never log this result.
export function nativeReadOnlyEnvironment({connection,endpoint,plan}) {
  assert.equal(plan.database.executor.authentication, 'database-password', 'DELIVERY_EXECUTOR_AUTHENTICATION');
  assert.ok(typeof connection === 'string' && connection.length <= 65536 && !/[\x00-\x1f\x7f]/.test(connection), 'DELIVERY_EXECUTOR_ENDPOINT');
  let url;
  try { url = new URL(connection); } catch { throw new Error('DELIVERY_EXECUTOR_ENDPOINT'); }
  assert.ok(endpoint.projectId === plan.database.projectId
    && /^[a-z]{20}$/.test(endpoint.projectId)
    && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/.test(endpoint.hostname)
    && endpoint.port === '5432' && endpoint.username === `postgres.${endpoint.projectId}`
    && endpoint.database === 'postgres' && url.protocol === 'postgresql:'
    && url.hostname === endpoint.hostname && url.port === endpoint.port
    && decodeURIComponent(url.username) === endpoint.username && url.pathname === '/postgres'
    && url.password.length > 0 && !url.hash, 'DELIVERY_EXECUTOR_ENDPOINT');
  const params = [...url.searchParams];
  assert.ok(params.length === 2 && new Set(params.map(([key]) => key)).size === 2
    && url.searchParams.get('sslmode') === 'require' && url.searchParams.get('connect_timeout') === '10', 'DELIVERY_EXECUTOR_OPTIONS');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  // Use native libpq fields, not a URI in PGDATABASE (which is a database name).
  Object.assign(env, { PGHOST: endpoint.hostname, PGPORT: endpoint.port,
    PGUSER: endpoint.username, PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: endpoint.database, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000 -c search_path=pg_catalog,public' });
  return env;
}
