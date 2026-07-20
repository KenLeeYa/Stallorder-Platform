import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

loadLocalEnv();

const port = 55431;
const ownerEmail = "owner@stallorder.test";
const oauthOwnerEmail = "oauth-owner@stallorder.test";
const noMembershipEmail = "oauth-new-user@stallorder.test";
const prelinkedOwnerAuthUserId = "11111111-1111-4111-8111-111111111111";
const ownerCode = "stallorder-e2e-google-code";
const noMembershipCode = "stallorder-e2e-google-no-membership-code";
const prelinkedOwnerCode = "stallorder-e2e-google-prelinked-owner-code";
const prisma = new PrismaClient();
const localSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const localSupabaseSecret = process.env.SUPABASE_SECRET_KEY;
if (!localSupabaseUrl || !localSupabaseSecret) {
  throw new Error("Local Supabase admin configuration is required for OAuth E2E tests");
}
const supabaseAdmin = createClient(localSupabaseUrl, localSupabaseSecret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (url.pathname === "/auth/v1/authorize") {
    const redirectTo = url.searchParams.get("redirect_to");
    if (url.searchParams.get("provider") !== "google" || !redirectTo) {
      sendJson(response, 400, { error: "invalid oauth request" });
      return;
    }
    const callback = new URL(redirectTo);
    const next = callback.searchParams.get("next");
    callback.searchParams.set("code", next === "/onboarding"
      ? noMembershipCode
      : next === "/merchant/dashboard" ? prelinkedOwnerCode : ownerCode);
    response.writeHead(302, { location: callback.toString() });
    response.end();
    return;
  }

  if (url.pathname === "/auth/v1/token" && request.method === "POST") {
    const body = await readJson(request);
    const acceptedCodes = new Set([ownerCode, noMembershipCode, prelinkedOwnerCode]);
    if (url.searchParams.get("grant_type") === "pkce" && !acceptedCodes.has(body.auth_code)) {
      sendJson(response, 400, { error: "invalid_grant" });
      return;
    }
    sendJson(response, 200, await sessionPayload(identityForCode(body.auth_code)));
    return;
  }

  if (url.pathname === "/auth/v1/user") {
    const authorization = request.headers.authorization ?? "";
    const identity = authorization.includes("no-membership")
      ? "no-membership"
      : authorization.includes("prelinked-owner") ? "prelinked-owner" : "oauth-owner";
    const session = await sessionPayload(identity);
    sendJson(response, 200, session.user);
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await prisma.$disconnect();
    server.close(() => process.exit(0));
  });
}

function identityForCode(code) {
  if (code === noMembershipCode) return "no-membership";
  if (code === prelinkedOwnerCode) return "prelinked-owner";
  return "oauth-owner";
}

async function sessionPayload(identity = "oauth-owner") {
  const noMembership = identity === "no-membership";
  const prelinkedOwner = identity === "prelinked-owner";
  const email = prelinkedOwner ? ownerEmail : noMembership ? noMembershipEmail : oauthOwnerEmail;
  const authUserId = prelinkedOwner
    ? prelinkedOwnerAuthUserId
    : await ensureAuthUser(email, noMembership ? "OAuth 新使用者" : "OAuth 示範商戶");
  const profile = prelinkedOwner
    ? { authUserId, displayName: "示範商戶" }
    : noMembership
      ? { authUserId, displayName: "OAuth 新使用者" }
      : await ensureOAuthOwner(authUserId);
  if (!profile.authUserId) throw new Error("E2E identity is not linked to an auth user");

  const now = new Date().toISOString();
  const tokenPrefix = prelinkedOwner
    ? "stallorder-e2e-prelinked-owner"
    : noMembership ? "stallorder-e2e-no-membership" : "stallorder-e2e";
  const user = {
    id: profile.authUserId,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: now,
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: {
      full_name: profile.displayName,
      avatar_url: "https://example.test/stallorder-owner.png",
    },
    identities: [],
    created_at: now,
    updated_at: now,
  };
  return {
    access_token: `${tokenPrefix}-access-token`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `${tokenPrefix}-refresh-token`,
    user,
  };
}

async function ensureAuthUser(email, displayName) {
  const { data: listed, error: listError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;
  const existing = listed.users.find((user) => user.email?.toLowerCase() === email);
  if (existing) return existing.id;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: displayName },
    app_metadata: { provider: "google", providers: ["google"] },
  });
  if (error || !data.user) throw error ?? new Error("Failed to create local OAuth E2E identity");
  return data.user.id;
}

async function ensureOAuthOwner(authUserId) {
  const sourceOwner = await prisma.profile.findUniqueOrThrow({
    where: { email: ownerEmail },
    include: {
      organizationMemberships: {
        where: { isActive: true, isPrimaryOwner: true },
        take: 1,
      },
    },
  });
  const sourceMembership = sourceOwner.organizationMemberships[0];
  if (!sourceMembership) throw new Error("E2E owner organization membership is missing");

  const profile = await prisma.profile.upsert({
    where: { email: oauthOwnerEmail },
    update: {
      authUserId,
      displayName: "OAuth 示範商戶",
      passwordHash: null,
      isActive: true,
    },
    create: {
      authUserId,
      email: oauthOwnerEmail,
      displayName: "OAuth 示範商戶",
    },
    select: { id: true, authUserId: true, displayName: true },
  });
  await prisma.organizationMembership.upsert({
    where: {
      organizationId_profileId_role: {
        organizationId: sourceMembership.organizationId,
        profileId: profile.id,
        role: "ORGANIZATION_OWNER",
      },
    },
    update: { allStalls: true, isActive: true, isPrimaryOwner: false },
    create: {
      organizationId: sourceMembership.organizationId,
      profileId: profile.id,
      role: "ORGANIZATION_OWNER",
      allStalls: true,
      isPrimaryOwner: false,
    },
  });
  return profile;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function loadLocalEnv() {
  if (process.env.DATABASE_URL) return;
  process.loadEnvFile?.(".env");
}
