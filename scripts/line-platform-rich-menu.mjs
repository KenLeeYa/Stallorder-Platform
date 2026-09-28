#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const policyHash = (policy) => hash(JSON.stringify({ ...policy, managerCheckedAt: undefined }));
const uuid = z.uuid();
const menuId = z.string().regex(/^richmenu-[a-f0-9]{32}$/);
const bindingSchema = z.object({ environment: z.enum(["local", "preview", "production"]),
  providerId: z.string().regex(/^\d{1,30}$/), channelId: z.string().regex(/^\d{1,30}$/),
  liffId: z.string().regex(/^\d+-[A-Za-z0-9]+$/), internalChannel: z.enum(["developing", "review", "published"]),
  endpointUrl: z.string().url(), oaDestination: z.string().regex(/^U[0-9a-f]{32}$/),
  oaChannelId: z.string().regex(/^\d{1,30}$/), oaAccessTokenReference: uuid, oaSecretReference: uuid,
  termsVersion: z.string().min(1).max(80), addFriendUrl: z.string().url().optional() }).strict();
const policySchema = z.object({ version: z.literal(1), operatorProfileId: uuid,
  manageScope: z.enum(["API", "MANAGER", "UNKNOWN"]),
  apiPolicy: z.enum(["EXCLUSIVE_PLATFORM", "SHARED_OR_UNKNOWN"]),
  managerMenuState: z.enum(["NONE_CONFIRMED", "PRESENT", "UNKNOWN"]),
  managerCheckedAt: z.iso.datetime(), manualRecoveryReference: z.string().min(8).max(500),
  expectedDefaultRichMenuId: menuId.nullable() }).strict();
export class RichMenuError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = (code) => { throw new RichMenuError(code); };

export function validateBinding(input, environment) {
  const result = bindingSchema.safeParse(input);
  if (!result.success) fail("RICH_MENU_BINDING_INVALID");
  const b = result.data; const endpoint = new URL(b.endpointUrl);
  if (b.environment !== environment || endpoint.protocol !== "https:" || endpoint.pathname !== "/mini"
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || /[%\\]/.test(b.endpointUrl) || endpoint.port
    || ((b.environment === "production") !== (b.internalChannel === "published"))
    || (b.environment !== "production" && endpoint.hostname === "app.qidaigo.com")) fail("RICH_MENU_ENVIRONMENT_MISMATCH");
  return b;
}
export function validatePolicy(input, now = Date.now()) {
  const result = policySchema.safeParse(input);
  if (!result.success) fail("RICH_MENU_POLICY_INVALID");
  const policy = result.data;
  if (policy.manageScope !== "API" || policy.apiPolicy !== "EXCLUSIVE_PLATFORM"
    || policy.managerMenuState !== "NONE_CONFIRMED") fail("RICH_MENU_MANAGEMENT_SCOPE_UNCONFIRMED");
  const age = now - Date.parse(policy.managerCheckedAt);
  if (age < -60_000 || age > 24 * 60 * 60_000) fail("RICH_MENU_MANAGER_CHECK_STALE");
  return policy;
}
export function assertSender(info, binding) {
  if (info?.userId !== binding.oaDestination) fail("RICH_MENU_SENDER_MISMATCH");
}
export function createManifest(binding) {
  const labels = ["立即點餐", "我的訂單", "會員中心", "使用協助"];
  const paths = ["", "/orders", "/member", "/help"];
  return { size: { width: 2500, height: 1686 }, selected: false, name: "QIDAIGO 平台四入口",
    chatBarText: "攤點通服務", areas: paths.map((path, i) => ({
      bounds: { x: (i % 2) * 1250, y: 166 + Math.floor(i / 2) * 760, width: 1250, height: 760 },
      action: { type: "uri", label: labels[i], uri: `https://miniapp.line.me/${binding.liffId}${path}` },
    })) };
}
export function verifyManifest(manifest, binding) {
  if (JSON.stringify(manifest) !== JSON.stringify(createManifest(binding))) fail("RICH_MENU_MANIFEST_CHANGED");
}
export function makePlan(payload) { return { ...payload, planHash: hash(JSON.stringify(payload)) }; }
export function verifyPlan(plan, expectedHash, binding, policy, image, manifest, toolHash, now = Date.now(), restoring = false) {
  const { planHash, ...payload } = plan;
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? "") || planHash !== expectedHash
    || hash(JSON.stringify(payload)) !== expectedHash) fail("RICH_MENU_PLAN_HASH_MISMATCH");
  if (payload.version !== 1 || !payload.providerVerified || payload.example
    || payload.bindingHash !== hash(JSON.stringify(binding)) || payload.policyHash !== policyHash(policy)
    || payload.imageHash !== hash(image) || payload.manifestHash !== hash(JSON.stringify(manifest))
    || payload.toolHash !== toolHash) fail("RICH_MENU_PLAN_CHANGED");
  if (!Number.isFinite(Date.parse(payload.createdAt)) || (!restoring && now - Date.parse(payload.createdAt) > 60 * 60_000)
    || Date.parse(payload.createdAt) > now + 60_000) fail("RICH_MENU_PLAN_EXPIRED");
  return payload;
}

export function renderSvg(brandPng) {
  const names = ["立即點餐", "我的訂單", "會員中心", "使用協助"];
  const subtitles = ["選店家・看菜單・輕鬆訂", "看進度・出示取餐 QR", "會員與訂單通知設定", "通知・付款・取餐問題"];
  const icons = [
    '<path d="M-75 -28h150l-10 108H-65zM-43 -25v-23a43 43 0 0 1 86 0v23"/>',
    '<path d="M-64 -76H64V80l-32-15-32 15-32-15-32 15zM-30 -34h60M-30 0h60M-30 34H8"/>',
    '<circle cy="-34" r="42"/><path d="M-78 86a78 78 0 0 1 156 0"/>',
    '<circle r="82"/><path d="M-28 -28a28 28 0 1 1 45 22q-17 12-17 31M0 51v2"/>',
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="1686" viewBox="0 0 2500 1686">
<rect width="2500" height="1686" fill="#f6f4ed"/>
<image href="data:image/png;base64,${brandPng.toString("base64")}" x="56" y="23" width="120" height="120"/>
<g font-family="Microsoft JhengHei, Noto Sans CJK TC, sans-serif"><text x="216" y="111" font-size="72" font-weight="700" fill="#117873">QIDAIGO 攤點通</text><text x="2430" y="103" text-anchor="end" font-size="40" fill="#53605b">每一餐，都有好照應</text>
${names.map((name, i) => { const x = (i % 2) * 1250; const y = 166 + Math.floor(i / 2) * 760; const dark = i === 0; const ink = dark ? "#ffffff" : "#175c57";
    return `<rect x="${x + 22}" y="${y + 16}" width="1206" height="728" rx="42" fill="${dark ? "#117873" : i === 1 ? "#E4F1EA" : "#ffffff"}"/>
<g transform="translate(${x + 625} ${y + 196})" fill="none" stroke="${ink}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">${icons[i]}</g>
<text x="${x + 625}" y="${y + 440}" text-anchor="middle" font-size="88" font-weight="700" fill="${ink}">${name}</text>
<text x="${x + 625}" y="${y + 535}" text-anchor="middle" font-size="46" fill="${dark ? "#e5f3eb" : "#56635e"}">${subtitles[i]}</text>
<text x="${x + 625}" y="${y + 652}" text-anchor="middle" font-size="46" fill="${ink}">進入 →</text>`;
  }).join("\n")}</g></svg>`;
}
export async function generateAssets(binding, outputDir) {
  // A permanent link must have a real application route, even in offline planning.
  for (const route of ["page.tsx", "orders/page.tsx", "member/page.tsx", "help/page.tsx"]) {
    await readFile(resolve(ROOT, "src/app/mini", route));
  }
  const brand = await readFile(resolve(ROOT, "public/icons/stallorder-512.png"));
  const svg = renderSvg(brand); const manifest = createManifest(binding);
  const image = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const metadata = await sharp(image).metadata();
  if (image.length > 1_000_000 || metadata.width !== 2500 || metadata.height !== 1686) fail("RICH_MENU_IMAGE_INVALID");
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "rich-menu.svg"), svg);
  await writeFile(resolve(outputDir, "rich-menu.png"), image);
  await writeFile(resolve(outputDir, "rich-menu.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { image, manifest, brandHash: hash(brand) };
}

// No caller-provided endpoint. Redirects cannot forward the bearer to another host.
export function createLineApi(token, fetcher = fetch) {
  return async (path, { method = "GET", body, image = false, allow404 = false, binary = false } = {}) => {
    if (!/^\/v2\/bot\//.test(path) || /[?%\\#]/.test(path) || path.includes("..")) fail("RICH_MENU_API_PATH_INVALID");
    const response = await fetcher(`https://${image ? "api-data" : "api"}.line.me${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": image ? "image/png" : "application/json" } : {}) },
      ...(body ? { body: image ? body : JSON.stringify(body) } : {}),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) fail(`RICH_MENU_LINE_HTTP_${response.status}`);
    if (binary) return Buffer.from(await response.arrayBuffer());
    const text = await response.text(); return text ? JSON.parse(text) : {};
  };
}
async function defaultMenu(api) {
  const result = await api("/v2/bot/user/all/richmenu", { allow404: true });
  if (!result) return null;
  return menuId.parse(result.richMenuId);
}
async function backupDefault(api, id) {
  if (!id) return { id: null, json: null, image: null };
  return { id, json: await api(`/v2/bot/richmenu/${id}`),
    image: await api(`/v2/bot/richmenu/${id}/content`, { image: true, binary: true }) };
}
async function requirePlatformOperator(binding, policy, env) {
  const { PrismaClient, Prisma } = await import("@prisma/client");
  if (!env.DATABASE_URL || env.LINE_PLATFORM_ENABLED !== "true") fail("RICH_MENU_SERVER_CONFIGURATION_REQUIRED");
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const operator = await db.profile.findFirst({ where: { id: policy.operatorProfileId, isActive: true, platformRole: "PLATFORM_ADMIN" }, select: { id: true } });
    if (!operator) fail("RICH_MENU_PLATFORM_ADMIN_REQUIRED");
    const integrations = await db.$queryRaw(Prisma.sql`select id from public.notification_integrations
      where sender_scope='PLATFORM_OA' and environment=${binding.environment}
      and provider_id=${binding.providerId} and oa_destination=${binding.oaDestination}
      and public_identifier=${binding.oaChannelId} and secret_reference=${binding.oaAccessTokenReference}::uuid
      and status='ACTIVE' and organization_id is null and stall_id is null`);
    if (integrations.length !== 1) fail("RICH_MENU_PLATFORM_BINDING_MISMATCH");
    const [secret] = await db.$queryRaw(Prisma.sql`select public.read_notification_secret(${binding.oaAccessTokenReference}::uuid) as value`);
    if (typeof secret?.value !== "string" || !secret.value) fail("RICH_MENU_TOKEN_UNAVAILABLE");
    return createLineApi(secret.value);
  } finally { await db.$disconnect(); }
}

const exampleBinding = { environment: "local", providerId: "1234567890", channelId: "1234567891",
  liffId: "1234567891-localfixture", internalChannel: "developing", endpointUrl: "https://rich-menu.local.test/mini",
  oaDestination: `U${"0".repeat(32)}`, oaChannelId: "1234567892",
  oaAccessTokenReference: "11111111-1111-4111-8111-111111111111", oaSecretReference: "22222222-2222-4222-8222-222222222222", termsVersion: "example-v1" };
function argsOf(args) {
  const flags = new Set(["--example", "--overwrite-existing"]);
  const values = new Set(["--policy", "--assets", "--output", "--plan", "--plan-hash"]);
  let mode = "dry-run"; const options = {};
  if (args[0] && !args[0].startsWith("--")) mode = args.shift();
  if (!["dry-run", "inspect", "apply", "restore"].includes(mode)) fail("RICH_MENU_MODE_INVALID");
  while (args.length) { const key = args.shift(); if (key in options) fail("RICH_MENU_ARGUMENT_DUPLICATE");
    if (flags.has(key)) options[key] = true;
    else if (values.has(key) && args[0] && !args[0].startsWith("--")) options[key] = args.shift();
    else fail("RICH_MENU_ARGUMENT_INVALID"); }
  return { mode, options };
}
const readJson = async (path) => JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
const saveNewJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });

export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  const { mode, options } = argsOf([...args]); const example = Boolean(options["--example"]);
  if (example && mode !== "dry-run") fail("RICH_MENU_EXAMPLE_OFFLINE_ONLY");
  const actualEnvironment = env.VERCEL_ENV === "production" ? "production" : env.VERCEL_ENV === "preview" ? "preview"
    : env.APP_ENV === "local" || ["test", "development"].includes(env.NODE_ENV) ? "local" : null;
  if (!example && actualEnvironment !== env.LINE_PLATFORM_ENVIRONMENT) fail("RICH_MENU_ENVIRONMENT_MISMATCH");
  const binding = validateBinding(example ? exampleBinding : JSON.parse(env.LINE_PLATFORM_BINDING_JSON ?? "{}"),
    example ? "local" : env.LINE_PLATFORM_ENVIRONMENT);
  const assets = resolve(options["--assets"] ?? resolve(ROOT, "public/line-platform"));
  const output = resolve(options["--output"] ?? resolve(ROOT, "artifacts/line-platform-rich-menu"));
  const relativeOutput = relative(resolve(ROOT, "public"), output);
  if (!isAbsolute(relativeOutput) && !relativeOutput.startsWith("..")) fail("RICH_MENU_PRIVATE_OUTPUT_REQUIRED");
  const toolHash = hash(await readFile(fileURLToPath(import.meta.url)));
  if (mode === "dry-run") {
    const generated = await generateAssets(binding, assets);
    await mkdir(output, { recursive: true });
    const draft = makePlan({ version: 1, createdAt: new Date().toISOString(), example, providerVerified: false,
      bindingHash: hash(JSON.stringify(binding)), imageHash: hash(generated.image),
      manifestHash: hash(JSON.stringify(generated.manifest)), brandHash: generated.brandHash, toolHash,
      blockers: ["PROVIDER_NOT_INSPECTED", "MANAGER_SCOPE_NOT_CONFIRMED", ...(example ? ["EXAMPLE_LINKS_REPLACE_BEFORE_USE"] : [])],
      links: generated.manifest.areas.map((area, i) => ({ label: area.action.label,
        appPath: ["/mini", "/mini/orders", "/mini/member", "/mini/help"][i], uri: area.action.uri })),
      welcomeDraft: "歡迎使用攤點通。您可以選擇合作店家點餐，並在這裡接收訂單與取餐通知。點選「立即點餐」開始；既有訂單請至「我的訂單」查看。",
    });
    await writeFile(resolve(output, "dry-run.json"), JSON.stringify(draft, null, 2) + "\n", { mode: 0o600 });
    return { mode, providerCalls: 0, publishable: false, example, imageBytes: generated.image.length, planHash: draft.planHash };
  }
  if (!options["--policy"]) fail("RICH_MENU_POLICY_REQUIRED");
  const policy = validatePolicy(await readJson(resolve(options["--policy"])));
  const manifest = await readJson(resolve(assets, "rich-menu.json")); verifyManifest(manifest, binding);
  const image = await readFile(resolve(assets, "rich-menu.png"));
  const metadata = await sharp(image).metadata();
  if (metadata.format !== "png" || metadata.width !== 2500 || metadata.height !== 1686 || image.length > 1_000_000) fail("RICH_MENU_IMAGE_INVALID");
  let plan;
  if (mode !== "inspect") {
    if (!options["--plan"] || !options["--plan-hash"]) fail("RICH_MENU_PLAN_REQUIRED");
    plan = await readJson(resolve(options["--plan"]));
    verifyPlan(plan, options["--plan-hash"], binding, policy, image, manifest, toolHash, Date.now(), mode === "restore");
  }
  const api = await (dependencies.requireOperator ?? requirePlatformOperator)(binding, policy, env);
  assertSender(await api("/v2/bot/info"), binding);
  const current = await defaultMenu(api);
  if (mode === "inspect") {
    if (current !== policy.expectedDefaultRichMenuId) fail("RICH_MENU_DEFAULT_DRIFT");
    const previous = await backupDefault(api, current);
    await mkdir(output, { recursive: true });
    if (previous.image) await writeFile(resolve(output, "previous-image.bin"), previous.image, { flag: "wx", mode: 0o600 });
    if (previous.json) await saveNewJson(resolve(output, "previous-menu.json"), previous.json);
    plan = makePlan({ version: 1, createdAt: new Date().toISOString(), example: false, providerVerified: true,
      bindingHash: hash(JSON.stringify(binding)), policyHash: policyHash(policy), managerCheckedAt: policy.managerCheckedAt,
      imageHash: hash(image), manifestHash: hash(JSON.stringify(manifest)), toolHash,
      previous: { id: previous.id, imageHash: previous.image ? hash(previous.image) : null,
        manifestHash: previous.json ? hash(JSON.stringify(previous.json)) : null },
    });
    await saveNewJson(resolve(output, "plan.json"), plan);
    return { mode, providerWrites: 0, previousDefault: current, planHash: plan.planHash };
  }
  const directory = dirname(resolve(options["--plan"]));
  if (plan.previous.id) {
    menuId.parse(plan.previous.id);
    const savedImage = await readFile(resolve(directory, "previous-image.bin"));
    const savedManifest = await readJson(resolve(directory, "previous-menu.json"));
    if (hash(savedImage) !== plan.previous.imageHash || hash(JSON.stringify(savedManifest)) !== plan.previous.manifestHash) fail("RICH_MENU_BACKUP_CHANGED");
  }
  if (mode === "apply") {
    if (current !== plan.previous.id) fail("RICH_MENU_DEFAULT_DRIFT");
    if (current && !options["--overwrite-existing"]) fail("RICH_MENU_OVERWRITE_FLAG_REQUIRED");
    const receiptPath = resolve(directory, "apply-receipt.json");
    const receipt = { version: 1, planHash: plan.planHash, previousDefault: current, newDefault: null, state: "STARTED" };
    await saveNewJson(receiptPath, receipt); // A failed/unknown attempt cannot be blindly repeated.
    try {
      const created = await api("/v2/bot/richmenu", { method: "POST", body: manifest });
      receipt.newDefault = menuId.parse(created.richMenuId); receipt.state = "CREATED";
      await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
      await api(`/v2/bot/richmenu/${receipt.newDefault}/content`, { method: "POST", image: true, body: image });
      // Recheck immediately before switching. Manager state still needs the explicit human attestation.
      assertSender(await api("/v2/bot/info"), binding);
      if (await defaultMenu(api) !== current) fail("RICH_MENU_DEFAULT_DRIFT");
      await api(`/v2/bot/user/all/richmenu/${receipt.newDefault}`, { method: "POST" });
      if (await defaultMenu(api) !== receipt.newDefault) fail("RICH_MENU_DEFAULT_READBACK_FAILED");
      receipt.state = "APPLIED";
    } catch (error) { receipt.state = "UNKNOWN_REQUIRES_READBACK"; throw error; }
    finally { await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 }); }
    return { mode, state: receipt.state, planHash: plan.planHash };
  }
  const receipt = await readJson(resolve(directory, "apply-receipt.json"));
  if (receipt.planHash !== plan.planHash || !menuId.safeParse(receipt.newDefault).success || current !== receipt.newDefault) fail("RICH_MENU_RESTORE_STATE_MISMATCH");
  if (!options["--overwrite-existing"]) fail("RICH_MENU_OVERWRITE_FLAG_REQUIRED");
  if (plan.previous.id) {
    const existing = await backupDefault(api, plan.previous.id);
    if (hash(existing.image) !== plan.previous.imageHash || hash(JSON.stringify(existing.json)) !== plan.previous.manifestHash) fail("RICH_MENU_PREVIOUS_MENU_DRIFT");
  }
  await saveNewJson(resolve(directory, "restore-started.json"), { planHash: plan.planHash, startedAt: new Date().toISOString() });
  await api(`/v2/bot/user/all/richmenu${plan.previous.id ? `/${plan.previous.id}` : ""}`, { method: plan.previous.id ? "POST" : "DELETE" });
  if (await defaultMenu(api) !== plan.previous.id) fail("RICH_MENU_RESTORE_READBACK_FAILED");
  await saveNewJson(resolve(directory, "restore-receipt.json"), { planHash: plan.planHash, state: "RESTORED", restoredAt: new Date().toISOString() });
  return { mode, state: "RESTORED", planHash: plan.planHash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error instanceof RichMenuError ? error.code : "RICH_MENU_OPERATION_FAILED"); process.exitCode = 1;
  });
}
