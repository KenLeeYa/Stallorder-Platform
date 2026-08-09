import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();

const port = Number(process.env.PLAYWRIGHT_OAUTH_MOCK_PORT ?? "55431");
if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
  throw new Error("PLAYWRIGHT_OAUTH_MOCK_PORT_INVALID");
}
const ownerEmail = "owner@stallorder.test";
const onboardingEmail = "onboarding.application.e2e@stallorder.test";
const platformAdminEmail = "platform.admin.e2e@stallorder.test";
const platformAdminAuthUserId = "a9000000-0000-4000-8000-000000000001";
const prisma = new PrismaClient();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (url.pathname === "/auth/v1/authorize") {
    const redirectTo = url.searchParams.get("redirect_to");
    if (
      url.searchParams.get("provider") !== "google"
      || url.searchParams.get("prompt") !== "select_account"
      || !redirectTo
    ) {
      sendJson(response, 400, { error: "invalid oauth request" });
      return;
    }
    const callback = new URL(redirectTo);
    const next = callback.searchParams.get("next");
    if (next === null) {
      const ownerCallback = new URL(callback);
      ownerCallback.searchParams.set("code", "stallorder-e2e-google-code");
      const platformAdminCallback = new URL(callback);
      platformAdminCallback.searchParams.set("code", "stallorder-e2e-platform-admin-code");
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(`<!doctype html>
        <html lang="zh-Hant">
          <head><meta charset="utf-8"><title>選擇測試帳號</title></head>
          <body>
            <h1>選擇測試帳號</h1>
            <a href="${platformAdminCallback.toString()}">${platformAdminEmail}</a>
            <a href="${ownerCallback.toString()}">${ownerEmail}</a>
          </body>
        </html>`);
      return;
    }
    callback.searchParams.set(
      "code",
      next === "/onboarding"
        ? "stallorder-e2e-onboarding-code"
        : next === "/admin/billing"
          ? "stallorder-e2e-platform-admin-code"
        : "stallorder-e2e-google-code",
    );
    response.writeHead(302, { location: callback.toString() });
    response.end();
    return;
  }

  if (url.pathname === "/auth/v1/token" && request.method === "POST") {
    const body = await readJson(request);
    const email = body.auth_code === "stallorder-e2e-onboarding-code"
      ? onboardingEmail
      : body.auth_code === "stallorder-e2e-platform-admin-code"
        ? platformAdminEmail
        : ownerEmail;
    if (
      url.searchParams.get("grant_type") === "pkce"
      && ![
        "stallorder-e2e-google-code",
        "stallorder-e2e-onboarding-code",
        "stallorder-e2e-platform-admin-code",
      ].includes(body.auth_code)
    ) {
      sendJson(response, 400, { error: "invalid_grant" });
      return;
    }
    try {
      sendJson(response, 200, await sessionPayload(email));
    } catch {
      sendJson(response, 400, { error: "invalid_grant" });
    }
    return;
  }

  if (url.pathname === "/auth/v1/user") {
    try {
      const session = await sessionPayload();
      sendJson(response, 200, session.user);
    } catch {
      sendJson(response, 401, { error: "invalid_token" });
    }
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

async function sessionPayload(email = ownerEmail) {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { email },
    select: { authUserId: true, displayName: true },
  });
  const authUserId = email === platformAdminEmail
    ? platformAdminAuthUserId
    : profile.authUserId;
  if (!authUserId) throw new Error("E2E profile is not linked to an auth user");

  const now = new Date().toISOString();
  const user = {
    id: authUserId,
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
    access_token: "stallorder-e2e-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "stallorder-e2e-refresh-token",
    user,
  };
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
