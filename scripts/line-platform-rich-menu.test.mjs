import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { main, validateBinding, validatePolicy, assertSender, createManifest, verifyManifest, createLineApi } from "./line-platform-rich-menu.mjs";

const binding = { environment: "preview", providerId: "1234567", channelId: "1234568", liffId: "1234568-fixture",
  internalChannel: "review", endpointUrl: "https://preview.example.test/mini", oaDestination: `U${"a".repeat(32)}`,
  oaChannelId: "1234569", oaAccessTokenReference: "11111111-1111-4111-8111-111111111111",
  oaSecretReference: "22222222-2222-4222-8222-222222222222", termsVersion: "test-v1" };
const oldId = `richmenu-${"a".repeat(32)}`; const newId = `richmenu-${"b".repeat(32)}`;
const policy = () => ({ version: 1, operatorProfileId: "33333333-3333-4333-8333-333333333333", manageScope: "API",
  apiPolicy: "EXCLUSIVE_PLATFORM", managerMenuState: "NONE_CONFIRMED", managerCheckedAt: new Date().toISOString(),
  manualRecoveryReference: "approved-operations-ticket-test", expectedDefaultRichMenuId: oldId });
const env = { VERCEL_ENV: "preview", LINE_PLATFORM_ENVIRONMENT: "preview", LINE_PLATFORM_BINDING_JSON: JSON.stringify(binding) };
async function workspace(t) {
  const prefix = resolve(tmpdir(), "qidaigo-rich-menu-test-"); const path = await mkdtemp(prefix);
  t.onTestFinished(async () => { if (!resolve(path).startsWith(prefix)) throw new Error("UNSAFE_TEST_CLEANUP"); await rm(path, { recursive: true }); });
  return { path, assets: resolve(path, "assets"), output: resolve(path, "plan"), policy: resolve(path, "policy.json") };
}
function mockLine(options = {}) {
  const calls = []; let current = oldId;
  const previousJson = { richMenuId: oldId, size: { width: 2500, height: 1686 }, name: "Previous", areas: [] };
  const api = async (path, args = {}) => {
    const method = args.method ?? "GET"; calls.push({ path, method });
    if (path === "/v2/bot/info") return { userId: options.badSender ? `U${"b".repeat(32)}` : binding.oaDestination };
    if (path === "/v2/bot/user/all/richmenu" && method === "GET") return current ? { richMenuId: current } : null;
    if (path === `/v2/bot/richmenu/${oldId}`) return previousJson;
    if (path === `/v2/bot/richmenu/${oldId}/content`) return Buffer.from("previous-image");
    if (path === "/v2/bot/richmenu" && method === "POST") return { richMenuId: newId };
    if (path === `/v2/bot/richmenu/${newId}/content`) {
      if (options.uploadFailure) throw new Error("SYNTHETIC_TIMEOUT");
      if (options.drift) current = `richmenu-${"c".repeat(32)}`;
      return {};
    }
    if (path.startsWith("/v2/bot/user/all/richmenu/") && method === "POST") { current = path.split("/").at(-1); return {}; }
    throw new Error("UNEXPECTED_FAKE_REQUEST");
  };
  return { api, calls, current: () => current };
}
async function prepared(t, options) {
  const w = await workspace(t); await writeFile(w.policy, JSON.stringify(policy()));
  await main(["--assets", w.assets, "--output", resolve(w.path, "draft")], env);
  const provider = mockLine(options); const deps = { requireOperator: async () => provider.api };
  const inspected = await main(["inspect", "--assets", w.assets, "--policy", w.policy, "--output", w.output], env, deps);
  const args = ["--assets", w.assets, "--policy", w.policy, "--plan", resolve(w.output, "plan.json"), "--plan-hash", inspected.planHash];
  return { ...w, provider, deps, args };
}

test("rejects malicious endpoint, identity and environment configuration", () => {
  for (const endpointUrl of ["http://preview.example.test/mini", "https://attacker@preview.example.test/mini", "https://preview.example.test/mini?token=x",
    "https://preview.example.test/mini#secret", "https://preview.example.test/%6dini", "https://preview.example.test:9000/mini", "https://app.qidaigo.com/mini"]) {
    assert.throws(() => validateBinding({ ...binding, endpointUrl }, "preview"));
  }
  assert.throws(() => validateBinding(binding, "production"));
  assert.throws(() => validateBinding({ ...binding, liffId: "123-http://evil" }, "preview"));
  assert.throws(() => validateBinding({ ...binding, oaDestination: "merchant-id" }, "preview"));
});
test("unknown/Manager/shared scope or stale attestation never authorizes API management", () => {
  for (const change of [{ manageScope: "UNKNOWN" }, { manageScope: "MANAGER" }, { apiPolicy: "SHARED_OR_UNKNOWN" },
    { managerMenuState: "PRESENT" }, { managerMenuState: "UNKNOWN" }, { managerCheckedAt: "2020-01-01T00:00:00Z" }]) {
    assert.throws(() => validatePolicy({ ...policy(), ...change }));
  }
});
test("exact bot sender and exact permanent-link manifest are required", () => {
  assert.doesNotThrow(() => assertSender({ userId: binding.oaDestination }, binding));
  assert.throws(() => assertSender({ userId: `U${"b".repeat(32)}` }, binding));
  const manifest = createManifest(binding);
  assert.deepEqual(manifest.areas.map((a) => new URL(a.action.uri).pathname),
    ["/1234568-fixture", "/1234568-fixture/orders", "/1234568-fixture/member", "/1234568-fixture/help"]);
  manifest.areas[0].action.uri = "https://attacker.test/";
  assert.throws(() => verifyManifest(manifest, binding));
});
test("HTTP adapter uses fixed LINE hosts and refuses redirect or path injection", async () => {
  const calls = []; const api = createLineApi("test-secret-never-print", async (url, init) => {
    calls.push({ url, init }); return new Response("{}", { status: 200 });
  });
  await api("/v2/bot/info");
  assert.equal(calls[0].url, "https://api.line.me/v2/bot/info"); assert.equal(calls[0].init.redirect, "error");
  for (const path of ["https://evil.test", "/v2/bot/../secret", "/v2/bot/%2e%2e/info", "/v2/bot/info?token=x"]) await assert.rejects(api(path));
  assert.equal(calls.length, 1);
});
test("actual default dry-run produces PNG, SVG, four routes and no provider calls", async (t) => {
  const w = await workspace(t); let calls = 0;
  const result = await main(["--example", "--assets", w.assets, "--output", w.output], {}, { requireOperator: async () => { calls++; throw new Error(); } });
  assert.equal(calls, 0); assert.equal(result.providerCalls, 0); assert.equal(result.publishable, false);
  const image = await readFile(resolve(w.assets, "rich-menu.png")); const meta = await sharp(image).metadata();
  assert.equal(meta.width, 2500); assert.equal(meta.height, 1686); assert.ok(image.length < 1_000_000);
  const draft = JSON.parse(await readFile(resolve(w.output, "dry-run.json"), "utf8"));
  assert.deepEqual(draft.links.map((x) => x.appPath), ["/mini", "/mini/orders", "/mini/member", "/mini/help"]);
  assert.equal(draft.providerVerified, false);
});
test("environment contradiction and unknown management stop before connecting", async (t) => {
  const w = await workspace(t); let calls = 0;
  const deps = { requireOperator: async () => { calls++; throw new Error(); } };
  await assert.rejects(main(["inspect"], { ...env, VERCEL_ENV: "production" }, deps));
  await writeFile(w.policy, JSON.stringify({ ...policy(), manageScope: "UNKNOWN" }));
  await assert.rejects(main(["inspect", "--policy", w.policy], env, deps));
  assert.equal(calls, 0);
});
test("recovery plans and backups cannot be written under the public web root", async () => {
  await assert.rejects(main(["--example", "--output", "public/line-platform/backups"]), { code: "RICH_MENU_PRIVATE_OUTPUT_REQUIRED" });
});
test("inspect saves previous configuration; overwrite flag gates apply; restore reads back previous default", async (t) => {
  const p = await prepared(t);
  assert.ok(await readFile(resolve(p.output, "previous-image.bin")));
  await assert.rejects(main(["apply", ...p.args], env, p.deps), { code: "RICH_MENU_OVERWRITE_FLAG_REQUIRED" });
  assert.equal(p.provider.calls.filter((c) => c.method !== "GET").length, 0);
  assert.equal((await main(["apply", ...p.args, "--overwrite-existing"], env, p.deps)).state, "APPLIED");
  assert.equal(p.provider.current(), newId);
  assert.equal((await main(["restore", ...p.args, "--overwrite-existing"], env, p.deps)).state, "RESTORED");
  assert.equal(p.provider.current(), oldId);
});
test("changed image or supplied approval hash stops before provider access", async (t) => {
  const p = await prepared(t); const before = p.provider.calls.length;
  const args = [...p.args]; args[args.length - 1] = "f".repeat(64);
  await assert.rejects(main(["apply", ...args, "--overwrite-existing"], env, p.deps), { code: "RICH_MENU_PLAN_HASH_MISMATCH" });
  assert.equal(p.provider.calls.length, before);
  const manifestPath = resolve(p.assets, "rich-menu.json"); const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.areas[2].action.uri = "https://evil.test/member"; await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(main(["apply", ...p.args, "--overwrite-existing"], env, p.deps), { code: "RICH_MENU_MANIFEST_CHANGED" });
  assert.equal(p.provider.calls.length, before);
});
test("incorrect sender blocks inspect without writes", async (t) => {
  const w = await workspace(t); await writeFile(w.policy, JSON.stringify(policy()));
  await main(["--assets", w.assets, "--output", resolve(w.path, "draft")], env);
  const provider = mockLine({ badSender: true });
  await assert.rejects(main(["inspect", "--assets", w.assets, "--policy", w.policy, "--output", w.output], env,
    { requireOperator: async () => provider.api }), { code: "RICH_MENU_SENDER_MISMATCH" });
  assert.equal(provider.calls.filter((c) => c.method !== "GET").length, 0);
});
test("uncertain upload preserves a recovery receipt and never blindly repeats creation", async (t) => {
  const p = await prepared(t, { uploadFailure: true });
  await assert.rejects(main(["apply", ...p.args, "--overwrite-existing"], env, p.deps));
  const receipt = JSON.parse(await readFile(resolve(p.output, "apply-receipt.json"), "utf8"));
  assert.equal(receipt.state, "UNKNOWN_REQUIRES_READBACK"); assert.equal(receipt.newDefault, newId);
  await assert.rejects(main(["apply", ...p.args, "--overwrite-existing"], env, p.deps));
  assert.equal(p.provider.calls.filter((c) => c.path === "/v2/bot/richmenu" && c.method === "POST").length, 1);
  assert.equal(p.provider.current(), oldId);
});
test("a changed default between upload and activation is not overwritten", async (t) => {
  const p = await prepared(t, { drift: true });
  await assert.rejects(main(["apply", ...p.args, "--overwrite-existing"], env, p.deps), { code: "RICH_MENU_DEFAULT_DRIFT" });
  assert.equal(p.provider.calls.filter((c) => c.path.includes("/user/all/") && c.method === "POST").length, 0);
});
