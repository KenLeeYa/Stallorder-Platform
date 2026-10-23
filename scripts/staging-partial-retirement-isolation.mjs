import { isDeepStrictEqual } from "node:util";
import { STAGING_TARGET, conversionApi, conversionDigest, conversionQuery } from "./dr-staging-conversion-plan.mjs";

const authSettings = { disable_signup: true, site_url: "https://staging.qidaigo.com",
  uri_allow_list: "https://staging.qidaigo.com/auth/callback", smtp_host: "disabled.staging.invalid",
  smtp_port: "465", smtp_user: "disabled", smtp_admin_email: "disabled@example.invalid",
  smtp_sender_name: "Staging email disabled", external_email_enabled: false };
const edgeSettings = { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", APP_ENV: "test",
  TURNSTILE_ALLOW_TEST_KEYS: "true", TURNSTILE_EXPECTED_HOSTNAME: "staging.qidaigo.com",
  PUBLIC_APP_ORIGINS: "https://staging.qidaigo.com", TRUSTED_CLIENT_IP_HEADER: "cf-connecting-ip" };
const randomEdgeNames = ["ABUSE_HASH_SECRET", "TOKEN_DERIVATION_SECRET"];
const counters = ["subscriptions", "activeCrons", "outgoingRequests", "authUsers", "storageObjects", "vaultSecrets", "privateSchemas"];
function requireIsolation(value) { if (!value) throw new Error("STAGING_PARTIAL_ISOLATION_INVALID"); }
const object = value => value && typeof value === "object" && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;

export function currentPartialIsolationQuery() {
  return `select
    (select pg_catalog.count(*)::pg_catalog.int4 from pg_catalog.pg_subscription) as subscriptions,
    (select pg_catalog.count(*)::pg_catalog.int4 from public.backend_runtime_state where is_current) as "currentBackends",
    exists(select 1 from public.backend_runtime_state where backend_code='DR' and is_current
      and backend_role='READ_ONLY_STANDBY' and not writes_enabled and enforcement_enabled) as fenced,
    (select pg_catalog.count(*)::pg_catalog.int4 from cron.job where active) as "activeCrons",
    (select pg_catalog.count(*)::pg_catalog.int4 from net.http_request_queue) as "outgoingRequests",
    (select pg_catalog.count(*)::pg_catalog.int4 from auth.users) as "authUsers",
    (select pg_catalog.count(*)::pg_catalog.int4 from storage.objects) as "storageObjects",
    (select pg_catalog.count(*)::pg_catalog.int4 from vault.secrets) as "vaultSecrets",
    (select pg_catalog.count(*)::pg_catalog.int4 from pg_catalog.pg_namespace where nspname in ('app_private','internal')) as "privateSchemas",
    (select pg_catalog.count(*)::pg_catalog.int4 from pg_catalog.pg_stat_activity
      where datname=pg_catalog.current_database() and pid<>pg_catalog.pg_backend_pid()
      and backend_type='client backend' and state is distinct from 'idle') as "otherActiveClients";`;
}

// Only the already-completed isolation checks. No original-data replacement,
// credential reveal/rotation, Storage deletion, reset, retry or target override.
// Private provider responses must never be logged or uploaded as evidence.
export async function readCurrentPartialIsolation() {
  let rows, auth, edge;
  try {
    [rows, auth, edge] = await Promise.all([
      conversionQuery(currentPartialIsolationQuery(), true),
      conversionApi("supabase", `/v1/projects/${STAGING_TARGET.ref}/config/auth`),
      conversionApi("supabase", `/v1/projects/${STAGING_TARGET.ref}/secrets`),
    ]);
  } catch { throw new Error("STAGING_PARTIAL_ISOLATION_READ_FAILED"); }
  requireIsolation(Array.isArray(rows) && rows.length === 1 && object(rows[0]));
  const database = rows[0];
  requireIsolation(isDeepStrictEqual(Object.keys(database).sort(), [...counters, "currentBackends", "fenced", "otherActiveClients"].sort())
    && counters.every(name => database[name] === 0) && database.currentBackends === 1 && database.fenced === true
    && count(database.otherActiveClients));
  requireIsolation(object(auth) && Object.entries(authSettings).every(([name, value]) => auth[name] === value));
  for (const [name, value] of Object.entries(auth)) {
    if (/^(external_|hook_).+_enabled$/.test(name)) {
      requireIsolation(value === false || (name.startsWith("hook_") && (value === null || value === "")));
    }
    if (/^(external_|hook_|sms_)/.test(name) && /(?:_secret|_secrets|_client_id|_token|_password|_pass|_key|_uri)$/.test(name)) {
      requireIsolation(value === null || value === "");
    }
  }
  requireIsolation(Array.isArray(edge) && edge.length < 100 && edge.every(item => object(item)
    && /^[A-Z][A-Z0-9_]{0,127}$/.test(item.name) && typeof item.value === "string" && /^[a-f0-9]{64}$/.test(item.value))
    && new Set(edge.map(item => item.name)).size === edge.length);
  const custom = edge.filter(item => !item.name.startsWith("SUPABASE_"));
  requireIsolation(isDeepStrictEqual(custom.map(item => item.name).sort(), [...Object.keys(edgeSettings), ...randomEdgeNames].sort())
    && Object.entries(edgeSettings).every(([name, value]) => custom.find(item => item.name === name)?.value === conversionDigest(value)));
  // Hash metadata alone cannot recover the lost runner-only plaintext, prove
  // fresh independent credentials, or prove that no idle/concurrent client can
  // write a non-MVCC sequence after this observation.
  return { diagnosticOnly: true, planQualified: false, currentDatabaseIsolationObserved: true,
    currentAuthIsolationObserved: true, knownEdgeSettingsMatched: true, customEdgeSecretCount: custom.length,
    otherActiveClients: database.otherActiveClients, independentEdgeCredentialsProven: false,
    sequenceWriterQuiescenceProven: false, privateIsolation: { database, auth, edge } };
}
