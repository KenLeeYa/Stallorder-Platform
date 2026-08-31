import { appendFile } from "node:fs/promises";

const accessToken = required("SUPABASE_ACCESS_TOKEN");
const options = process.argv.slice(2);
if (options.length > 1 || (options[0] && options[0] !== "--dr-only")) {
  throw new Error("UNSUPPORTED_ARGUMENTS");
}
const drOnly = options[0] === "--dr-only";
const primaryRef = drOnly ? null : required("PRIMARY_SUPABASE_PROJECT_REF");
const drRef = required("DR_SUPABASE_PROJECT_REF");
const output = required("GITHUB_ENV");

try {
  const [primaryKeys, drKeys] = await Promise.all([
    primaryRef ? apiKeys(primaryRef) : Promise.resolve(null),
    apiKeys(drRef),
  ]);
  const primarySecret = primaryKeys ? selectKey(primaryKeys, "secret") : null;
  const drSecret = selectKey(drKeys, "secret");
  const drPublishable = selectKey(drKeys, "publishable");
  for (const secret of [primarySecret, drSecret].filter(Boolean)) {
    console.log(`::add-mask::${secret}`);
  }

  const values = {
    ...(primaryRef ? {
      PRIMARY_SUPABASE_URL: `https://${primaryRef}.supabase.co`,
      PRIMARY_SUPABASE_SECRET_KEY: primarySecret,
    } : {}),
    DR_SUPABASE_URL: `https://${drRef}.supabase.co`,
    DR_SUPABASE_SECRET_KEY: drSecret,
    DR_SUPABASE_PUBLISHABLE_KEY: drPublishable,
    DR_SUPABASE_FUNCTIONS_URL: `https://${drRef}.supabase.co/functions/v1`,
  };
  await appendFile(
    output,
    Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n") + "\n",
    { encoding: "utf8" },
  );
  console.log(JSON.stringify({
    event: "dr_runtime_environment_exported",
    variableNames: Object.keys(values),
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_runtime_environment_export_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
}

async function apiKeys(projectRef) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`SUPABASE_API_KEYS_${response.status}`);
  return response.json();
}

function selectKey(keys, type) {
  const preferred = keys.find((key) => key.type === type && key.name === "default")
    ?? keys.find((key) => key.type === type)
    ?? (type === "secret"
      ? keys.find((key) => key.name === "service_role")
      : keys.find((key) => key.name === "anon"));
  const value = preferred?.api_key ?? preferred?.value;
  if (!value) throw new Error(`SUPABASE_${type.toUpperCase()}_KEY_MISSING`);
  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}
