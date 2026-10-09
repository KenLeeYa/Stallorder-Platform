import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";

const mocks = vi.hoisted(() => ({ exec: vi.fn(), write: vi.fn(), open: vi.fn(), artifactWrite: vi.fn(), close: vi.fn(), mkdir: vi.fn(), mkdtemp: vi.fn(), exportVariable: vi.fn(), setSecret: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.exec }));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, mkdtemp: mocks.mkdtemp, open: mocks.open, writeFile: mocks.write, readFile: vi.fn() }));
vi.mock("@actions/core", () => ({ exportVariable: mocks.exportVariable, setSecret: mocks.setSecret }));
const originalArgv = [...process.argv];
const values = { ABUSE_HASH_SECRET: "original-abuse", TOKEN_DERIVATION_SECRET: "original-token" };
let publicKey;
let deployedConfig;
let scenario;
beforeAll(() => {
  publicKey = generateKeyPairSync("rsa", { modulusLength: 4096 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
});
beforeEach(() => {
  vi.resetModules();
  scenario = "success";
  deployedConfig = undefined;
  process.argv.splice(2, process.argv.length, "apply");
  vi.stubEnv("SUPABASE_PROJECT_REF", "abcdefghijklmnopqrst");
  vi.stubEnv("SUPABASE_ACCESS_TOKEN", "test-management-token");
  vi.stubEnv("RECOVERY_RECIPIENT_PUBLIC_KEY_BASE64", publicKey);
  vi.stubEnv("RECOVERY_CONFIRMATION", "RECOVER_PUBLIC_ORDER_ORIGINAL_SECRETS");
  mocks.mkdtemp.mockResolvedValue("/tmp/test-recovery-owned");
  mocks.open.mockImplementation(async () => {
    if (scenario === "collision") throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
    return { writeFile: mocks.artifactWrite, close: mocks.close };
  });
  mocks.write.mockImplementation(async (path, data) => {
    if (String(path).endsWith("index.ts")) {
      const configSource = data.split("Deno.serve(createPublicOrderSecretRecoveryHandler(").at(-1).split(", { getEnv:")[0];
      deployedConfig = JSON.parse(configSource);
    }
  });
  mocks.exec.mockImplementation((_node, args) => {
    if (scenario === "plan-fails" && args[0].endsWith("production-approval.mjs")) throw new Error("verification failed");
    if (scenario === "deploy-uncertain" && args.includes("deploy")) throw new Error("uncertain deploy");
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (scenario === "preparation-fails" && url.endsWith("/functions")) return new Response(null, { status: 503 });
    if (scenario === "redirect" && options.redirect !== "error") throw new Error("unsafe redirect allowed");
    if (url.endsWith("/secrets")) return Response.json(Object.entries(values).map(([name, value]) => ({ name, value: createHash("sha256").update(value).digest("hex") })));
    if (url.endsWith("/api-keys?reveal=true")) return Response.json([{ name: "service_role", api_key: "legacy.service.jwt" }]);
    if (url.endsWith("/functions")) return Response.json([]);
    if (scenario === "invoke-fails") return new Response(null, { status: 503 });
    const envelope = { projectRef: deployedConfig.projectRef, recoveryId: deployedConfig.recoveryId, schemaVersion: 1,
      ciphertext: Buffer.alloc(80).toString("base64"), wrappedKey: Buffer.alloc(512).toString("base64"), iv: Buffer.alloc(12).toString("base64") };
    if (scenario === "extra-plaintext") envelope.plaintext = "must-never-persist";
    if (scenario === "bad-iv") envelope.iv = Buffer.alloc(11).toString("base64");
    return Response.json(envelope);
  }));
});
afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArgv);
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.values(mocks).forEach(mock => mock.mockReset());
});

describe("protected runtime recovery orchestration", () => {
  it("makes Plan read-only and binds the recipient and canonical digests", async () => {
    process.argv[2] = "prepare";
    await import("./recover-public-order-runtime-secrets.mjs");
    expect(process.exitCode).not.toBe(1);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    const parameters = JSON.parse(mocks.exportVariable.mock.calls[0][1]);
    expect(parameters.secretRotation).toBe(false);
    expect(parameters.secretNames).toEqual(Object.keys(values));
    expect(parameters.recipientFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not deploy or invoke when immutable Plan verification fails", async () => {
    scenario = "plan-fails";
    await import("./recover-public-order-runtime-secrets.mjs");
    expect(process.exitCode).toBe(1);
    expect(mocks.exec.mock.calls).toHaveLength(1);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(["success", "invoke-fails", "deploy-uncertain"])("removes only the generated function after %s", async (mode) => {
    scenario = mode;
    await import("./recover-public-order-runtime-secrets.mjs");
    const commands = mocks.exec.mock.calls.map(call => call[1]);
    const deploy = commands.find(args => args.includes("deploy"));
    const cleanup = commands.find(args => args.includes("delete"));
    expect(deploy[3]).toMatch(/^recover-public-order-[a-f0-9]{16}$/);
    expect(cleanup[3]).toBe(deploy[3]);
    expect(cleanup).toContain("abcdefghijklmnopqrst");
    expect(deploy).not.toContain("--no-verify-jwt");
    expect(deployedConfig.serviceAuthorizationHash).toBe(createHash("sha256").update("Bearer legacy.service.jwt").digest("hex"));
    expect(JSON.stringify(deployedConfig)).not.toContain("legacy.service.jwt");
    expect(mocks.artifactWrite).toHaveBeenCalledTimes(mode === "success" ? 1 : 0);
    expect(JSON.stringify(console.log.mock.calls)).not.toContain("legacy.service.jwt");
    expect(JSON.stringify(console.log.mock.calls)).toContain("public_order_recovery_function_deleted");
    if (mode === "invoke-fails") expect(JSON.stringify(console.error.mock.calls)).toContain("RECOVERY_INVOKE_FAILED_HTTP_503");
  });
  it("rejects artifact collision before deployment and preserves the existing artifact", async () => {
    scenario = "collision";
    await import("./recover-public-order-runtime-secrets.mjs");
    expect(process.exitCode).toBe(1);
    expect(mocks.exec.mock.calls.some((call) => call[1].includes("deploy"))).toBe(false);
    expect(mocks.exec.mock.calls.some((call) => call[1].includes("delete"))).toBe(false);
    expect(mocks.artifactWrite).not.toHaveBeenCalled();
    // Canonical digest retrieval is required before immutable approval verification;
    // recover itself must make zero API requests on collision.
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/secrets"]);
  });
  it("closes the reservation after preparation failure without deployment or cleanup", async () => {
    scenario = "preparation-fails";
    await import("./recover-public-order-runtime-secrets.mjs");
    expect(process.exitCode).toBe(1);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.exec.mock.calls.some((call) => call[1].includes("deploy") || call[1].includes("delete"))).toBe(false);
    expect(mocks.artifactWrite).not.toHaveBeenCalled();
    expect(JSON.stringify(console.error.mock.calls)).toContain("RECOVERY_MANAGEMENT_READ_FAILED");
  });
  it.each(["extra-plaintext", "bad-iv"])("rejects %s without persisting remote fields", async (mode) => {
    scenario = mode;
    await import("./recover-public-order-runtime-secrets.mjs");
    expect(process.exitCode).toBe(1);
    expect(mocks.artifactWrite).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(console.error.mock.calls)).toContain("RECOVERY_RESPONSE_INVALID");
  });
  it("rejects redirects on all credential-bearing requests and reserves an exclusive private artifact", async () => {
    scenario = "redirect";
    await import("./recover-public-order-runtime-secrets.mjs");
    expect(process.exitCode).not.toBe(1);
    for (const [, options] of fetch.mock.calls) expect(options.redirect).toBe("error");
    expect(mocks.open).toHaveBeenCalledWith("artifacts/public-order-secret-envelope.json", "wx", 0o600);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("preserves the invocation error if owned cleanup and close also fail", async () => {
    scenario = "invoke-fails";
    mocks.exec.mockImplementation((_node, args) => { if (args.includes("delete")) throw new Error("cleanup"); });
    mocks.close.mockRejectedValue(new Error("close"));
    await import("./recover-public-order-runtime-secrets.mjs");
    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(console.error.mock.calls)).toContain("RECOVERY_INVOKE_FAILED_HTTP_503");
    expect(mocks.artifactWrite).not.toHaveBeenCalled();
  });
});
