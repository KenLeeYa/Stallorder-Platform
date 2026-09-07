import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";

const mocks = vi.hoisted(() => ({ exec: vi.fn(), write: vi.fn(), mkdir: vi.fn(), mkdtemp: vi.fn(), exportVariable: vi.fn(), setSecret: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.exec }));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, mkdtemp: mocks.mkdtemp, writeFile: mocks.write, readFile: vi.fn() }));
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
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url.endsWith("/secrets")) return Response.json(Object.entries(values).map(([name, value]) => ({ name, value: createHash("sha256").update(value).digest("hex") })));
    if (url.endsWith("/api-keys?reveal=true")) return Response.json([{ name: "service_role", api_key: "legacy.service.jwt" }]);
    if (url.endsWith("/functions")) return Response.json([]);
    if (scenario === "invoke-fails") return new Response(null, { status: 503 });
    return Response.json({ projectRef: deployedConfig.projectRef, recoveryId: deployedConfig.recoveryId, schemaVersion: 1, ciphertext: "encrypted-only", wrappedKey: "wrapped-key", iv: "iv" });
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
    const artifacts = mocks.write.mock.calls.filter(call => String(call[0]).endsWith("public-order-secret-envelope.json"));
    expect(artifacts).toHaveLength(mode === "success" ? 1 : 0);
    expect(JSON.stringify(console.log.mock.calls)).not.toContain("legacy.service.jwt");
  });
});
