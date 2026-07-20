#!/usr/bin/env bash
set -euo pipefail
set +x

target="${1:-}"
mode="${2:-}"
if [[ ! "$target" =~ ^(production|staging|local)$ ]]; then
  echo "Usage: $0 <production|staging|local> [--apply|--rollback]" >&2
  exit 2
fi

case "$target" in
  production)
    project_ref="eyuctbnlvnbnivwasvqr"
    site_url="https://app.qidaigo.com"
    redirect_urls="https://app.qidaigo.com/auth/callback,https://app.qidaigo.com/invite/claim"
    ;;
  staging)
    project_ref="daeqwtpaxcebmtwxqdkj"
    site_url="https://staging.qidaigo.com"
    redirect_urls="https://staging.qidaigo.com/auth/callback,https://staging.qidaigo.com/invite/claim"
    ;;
  local)
    project_ref=""
    site_url="http://localhost:3000"
    redirect_urls="http://localhost:3000/auth/callback,http://127.0.0.1:3000/auth/callback"
    ;;
esac

echo "Target: $target"
echo "Site URL: $site_url"
echo "Redirect URLs: $redirect_urls"
if [[ "$mode" != "--apply" && "$mode" != "--rollback" ]]; then
  echo "Dry run only. Re-run with --apply or --rollback."
  exit 0
fi

if [[ "$target" == "local" && "$mode" == "--rollback" ]]; then
  node <<'NODE'
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const file = ".env";
if (existsSync(file)) {
  const keys = new Set([
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET",
    "NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED",
  ]);
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => !keys.has(line.split("=", 1)[0]));
  writeFileSync(file, `${lines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
}
NODE
  echo "Local Google OAuth values removed from the ignored .env file."
  exit 0
fi

if [[ "$target" != "local" ]]; then
  if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    read -rsp "Supabase access token: " SUPABASE_ACCESS_TOKEN
    echo
    export SUPABASE_ACCESS_TOKEN
  fi
fi

if [[ "$mode" == "--rollback" ]]; then
  TARGET_PROJECT_REF="$project_ref" node <<'NODE'
(async () => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${process.env.TARGET_PROJECT_REF}/config/auth`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ external_google_enabled: false }),
  });
  if (!response.ok) throw new Error(`Supabase update failed with HTTP ${response.status}`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE
  echo "Google Provider disabled. Existing credentials were not printed or deleted."
  unset SUPABASE_ACCESS_TOKEN
  exit 0
fi

read -rp "Google OAuth Client ID: " client_id
if [[ ! "$client_id" =~ ^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$ ]]; then
  echo "Client ID is not a Google OAuth Web Client ID." >&2
  exit 1
fi
read -rsp "Google OAuth Client Secret: " client_secret
echo
if [[ ! "$client_secret" =~ ^[A-Za-z0-9_-]{20,}$ ]]; then
  echo "Client Secret format is invalid." >&2
  exit 1
fi

export OAUTH_CLIENT_ID="$client_id"
export OAUTH_CLIENT_SECRET="$client_secret"
export TARGET_PROJECT_REF="$project_ref"
export TARGET_SITE_URL="$site_url"
export TARGET_REDIRECT_URLS="$redirect_urls"

if [[ "$target" == "local" ]]; then
  node <<'NODE'
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const file = ".env";
const values = new Map([
  ["SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID", process.env.OAUTH_CLIENT_ID],
  ["SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET", process.env.OAUTH_CLIENT_SECRET],
  ["NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED", "true"],
]);
const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
const seen = new Set();
const updated = lines.filter(Boolean).map((line) => {
  const key = line.split("=", 1)[0];
  if (!values.has(key)) return line;
  seen.add(key);
  return `${key}="${values.get(key)}"`;
});
for (const [key, value] of values) if (!seen.has(key)) updated.push(`${key}="${value}"`);
writeFileSync(file, `${updated.join("\n")}\n`, { mode: 0o600 });
NODE
  echo "Local Google OAuth configured in the ignored .env file."
else
  node <<'NODE'
(async () => {
  const uri = `https://api.supabase.com/v1/projects/${process.env.TARGET_PROJECT_REF}/config/auth`;
  const headers = {
    authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
    "content-type": "application/json",
  };
  const currentResponse = await fetch(uri, { headers });
  if (!currentResponse.ok) throw new Error(`Supabase config read failed with HTTP ${currentResponse.status}`);
  const current = await currentResponse.json();
  if (current.external_google_enabled && current.external_google_client_id && current.external_google_client_id !== process.env.OAUTH_CLIENT_ID) {
    throw new Error("A different Google Client ID is already enabled. Review and rotate it manually before applying.");
  }
  const redirects = new Set([
    ...(current.uri_allow_list ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    ...process.env.TARGET_REDIRECT_URLS.split(","),
  ]);
  const response = await fetch(uri, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      external_google_enabled: true,
      external_google_client_id: process.env.OAUTH_CLIENT_ID,
      external_google_secret: process.env.OAUTH_CLIENT_SECRET,
      site_url: process.env.TARGET_SITE_URL,
      uri_allow_list: [...redirects].join(","),
    }),
  });
  if (!response.ok) throw new Error(`Supabase update failed with HTTP ${response.status}`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE
  echo "Google Provider enabled: yes"
fi

echo "Client ID suffix: ${client_id: -6}"
echo "Secret configured: yes"
unset client_id client_secret OAUTH_CLIENT_ID OAUTH_CLIENT_SECRET SUPABASE_ACCESS_TOKEN TARGET_PROJECT_REF TARGET_SITE_URL TARGET_REDIRECT_URLS
