import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "55555555-5555-4555-8555-555555555551";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";
const TEST_CONFIRMATION = "EPHEMERAL_PREVIEW_ONLY";
const expectedTerms = new Map([
  ["en", "Winter Melon Tea"],
  ["ja", "冬瓜茶"],
  ["ko", "동과차"],
  ["vi", "Trà bí đao"],
  ["th", "ชาฟักเขียว"],
]);

const baseUrl = normalizeBaseUrl(required("CATALOG_TRANSLATION_SYNTHETIC_BASE_URL"));
const confirmation = required("CATALOG_TRANSLATION_SYNTHETIC_CONFIRMATION");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";

if (confirmation !== TEST_CONFIRMATION) {
  fail(`CATALOG_TRANSLATION_SYNTHETIC_CONFIRMATION must equal ${TEST_CONFIRMATION}.`);
}
assertSafeSyntheticHost(baseUrl);
required("EPHEMERAL_DATABASE_URL");

const prisma = new PrismaClient();
let requestId = null;
let sessionId = null;
let originalTranslations = [];
let originalRateLimitBuckets = [];
const rateLimitKeys = [
  rateLimitKey(
    "catalog-ai-translation-actor",
    `${ORGANIZATION_ID}:${PROFILE_ID}`,
  ),
  rateLimitKey("catalog-ai-translation-organization", ORGANIZATION_ID),
];

try {
  originalTranslations = await prisma.productTranslation.findMany({
    where: {
      organizationId: ORGANIZATION_ID,
      productId: PRODUCT_ID,
      locale: { in: [...expectedTerms.keys()] },
    },
    orderBy: { locale: "asc" },
  });
  if (originalTranslations.length !== expectedTerms.size) {
    fail("Winter melon tea Preview fixture is incomplete.");
  }
  originalRateLimitBuckets = await prisma.rateLimitBucket.findMany({
    where: { key: { in: rateLimitKeys } },
  });

  const session = await createSyntheticSession();
  sessionId = session.id;
  const cleared = await prisma.productTranslation.updateMany({
    where: {
      organizationId: ORGANIZATION_ID,
      productId: PRODUCT_ID,
      locale: { in: [...expectedTerms.keys()] },
    },
    data: { description: "" },
  });
  if (cleared.count !== expectedTerms.size) {
    fail("Winter melon tea Preview descriptions were not isolated for the smoke.");
  }

  const response = await requestRaw(
    `/api/merchant/organizations/${ORGANIZATION_ID}/catalog/translate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
        "sec-fetch-site": "same-origin",
        origin: baseUrl.origin,
        referer: `${baseUrl.origin}/merchant/localization`,
        cookie: `stallorder_session=${encodeURIComponent(session.token)}; stallorder_csrf=${encodeURIComponent(session.csrfToken)}; stallorder_auth_device=${encodeURIComponent(session.deviceId)}`,
      },
      body: JSON.stringify({ mode: "MISSING_ONLY" }),
    },
  );
  requestId = response.headers.get("x-request-id");
  const payload = await response.json().catch(() => null);
  if (response.status !== 200) {
    if ((response.status === 401 || response.status === 403) && !protectionBypass) {
      fail("Catalog translation smoke was blocked. Configure VERCEL_AUTOMATION_BYPASS_SECRET for Preview.");
    }
    fail(`Catalog translation smoke returned HTTP ${response.status}: ${payload?.error ?? "unknown error"}.`);
  }

  const translated = await prisma.productTranslation.findMany({
    where: {
      organizationId: ORGANIZATION_ID,
      productId: PRODUCT_ID,
      locale: { in: [...expectedTerms.keys()] },
    },
    orderBy: { locale: "asc" },
    select: { locale: true, name: true, description: true },
  });
  const originalByLocale = new Map(
    originalTranslations.map((translation) => [translation.locale, translation]),
  );
  for (const row of translated) {
    const expectedTerm = expectedTerms.get(row.locale);
    if (!expectedTerm || !row.description.includes(expectedTerm)) {
      fail(`Winter melon tea glossary term was not preserved for ${row.locale}.`);
    }
    if (row.name !== originalByLocale.get(row.locale)?.name) {
      fail(`Existing merchant translation was overwritten for ${row.locale}.`);
    }
    if (/<\/?span\b|notranslate/iu.test(row.description)) {
      fail(`Translator markup leaked into the ${row.locale} description.`);
    }
  }
  if (
    translated.length !== expectedTerms.size
    || !Number.isInteger(payload?.summary?.translatedFields)
    || payload.summary.translatedFields < expectedTerms.size
    || !Number.isInteger(payload?.summary?.translatedProducts)
    || payload.summary.translatedProducts < 1
  ) {
    fail("Catalog translation smoke did not persist all five missing descriptions.");
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    product: "冬瓜茶",
    translatedDescriptions: translated.map(({ locale, description }) => ({ locale, description })),
    translatedFields: payload.summary.translatedFields,
    translatedProducts: payload.summary.translatedProducts,
    restoredByFinally: true,
  }) + "\n");
} finally {
  try {
    await restoreFixture();
  } finally {
    await prisma.$disconnect();
  }
}

async function createSyntheticSession() {
  const profile = await prisma.profile.findUnique({
    where: { id: PROFILE_ID },
    select: { id: true, isActive: true, sessionVersion: true },
  });
  if (!profile?.isActive) fail("Synthetic Preview profile is missing or inactive.");

  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const deviceId = randomUUID();
  const stored = await prisma.authSession.create({
    data: {
      profileId: profile.id,
      tokenHash: sha256(token),
      csrfTokenHash: sha256(csrfToken),
      profileSessionVersion: profile.sessionVersion,
      deviceId,
      userAgentHash: sha256("stallorder-catalog-translation-preview-smoke"),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
    select: { id: true },
  });
  return { id: stored.id, token, csrfToken, deviceId };
}

async function restoreFixture() {
  await prisma.$transaction(async (transaction) => {
    for (const translation of originalTranslations) {
      await transaction.productTranslation.update({
        where: {
          productId_locale: {
            productId: translation.productId,
            locale: translation.locale,
          },
        },
        data: {
          name: translation.name,
          description: translation.description,
          updatedAt: translation.updatedAt,
        },
      });
    }
    if (requestId) {
      await transaction.auditLog.deleteMany({ where: { requestId } });
    }
    if (sessionId) {
      await transaction.authSession.deleteMany({ where: { id: sessionId } });
    }
    await transaction.rateLimitBucket.deleteMany({
      where: { key: { in: rateLimitKeys } },
    });
    for (const bucket of originalRateLimitBuckets) {
      await transaction.rateLimitBucket.create({ data: bucket });
    }
  });
}

async function requestRaw(path, init) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("user-agent", "stallorder-catalog-translation-preview-smoke");
  if (protectionBypass) headers.set("x-vercel-protection-bypass", protectionBypass);
  return fetch(new URL(path, baseUrl), {
    ...init,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(300_000),
  });
}

function assertSafeSyntheticHost(url) {
  const hostname = url.hostname.toLowerCase();
  const blocked = new Set([
    "app.qidaigo.com",
    "qidaigo.com",
    "www.qidaigo.com",
    "stallorder-platform.vercel.app",
  ]);
  if (blocked.has(hostname)) fail("Catalog translation synthetic smoke is forbidden against Production.");
  if (
    hostname !== "localhost"
    && hostname !== "127.0.0.1"
    && !hostname.endsWith(".vercel.app")
  ) {
    fail("Catalog translation synthetic smoke target is not an approved ephemeral host.");
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function rateLimitKey(scope, identifier) {
  return sha256(`${scope}:${identifier}`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Missing required environment variable: ${name}.`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(message);
}
