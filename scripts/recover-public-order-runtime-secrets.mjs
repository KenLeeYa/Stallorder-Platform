import { createHash, createPublicKey, randomBytes, randomUUID, generateKeyPairSync, privateDecrypt, constants, createDecipheriv } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { exportVariable, setSecret } from "@actions/core";
import { createPublicOrderSecretRecoveryHandler } from "./lib/public-order-secret-recovery.mjs";

const names = ["ABUSE_HASH_SECRET", "TOKEN_DERIVATION_SECRET"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const mode = process.argv[2];
try {
  if (mode === "initialize") {
    await mkdir(".secrets", { recursive: true });
    const keys = generateKeyPairSync("rsa", { modulusLength: 4096 });
    await writeFile(".secrets/public-order-recovery-private.pem", keys.privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 });
    await writeFile(".secrets/public-order-recovery-public.txt", keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"), { flag: "wx" });
    console.log(JSON.stringify({ event: "recovery_recipient_initialized", privateKeyLocation: ".secrets/public-order-recovery-private.pem" }));
  } else if (mode === "prepare" || mode === "apply") {
    const projectRef = required("SUPABASE_PROJECT_REF");
    if (!/^[a-z]{20}$/.test(projectRef)) throw new Error("RECOVERY_PROJECT_REF_INVALID");
    const recipientPublicKey = required("RECOVERY_RECIPIENT_PUBLIC_KEY_BASE64");
    const key = createPublicKey({ key: Buffer.from(recipientPublicKey, "base64"), type: "spki", format: "der" });
    if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength !== 4096) throw new Error("RECOVERY_RECIPIENT_KEY_INVALID");
    const digests = await expectedDigests(projectRef);
    const parameters = { projectRef, recipientFingerprint: hash(Buffer.from(recipientPublicKey, "base64")),
      secretNames: names, digests, maximumFunctionLifetimeSeconds: 300, databaseChanges: false, secretRotation: false };
    exportVariable("PRODUCTION_APPROVAL_PARAMETERS_JSON", JSON.stringify(parameters));
    if (mode === "apply") {
      if (required("RECOVERY_CONFIRMATION") !== "RECOVER_PUBLIC_ORDER_ORIGINAL_SECRETS") throw new Error("RECOVERY_CONFIRMATION_REQUIRED");
      runNode("scripts/production-approval.mjs", ["verify"]);
      await recover(projectRef, recipientPublicKey, digests);
    }
  } else if (mode === "decrypt") {
    const envelope = JSON.parse(await readFile(required("RECOVERY_ENVELOPE_PATH"), "utf8"));
    const projectRef = required("SUPABASE_PROJECT_REF");
    if (envelope.schemaVersion !== 1 || envelope.projectRef !== projectRef || envelope.functionDeleted !== true) throw new Error("RECOVERY_ENVELOPE_INVALID");
    const key = privateDecrypt({ key: await readFile(".secrets/public-order-recovery-private.pem"), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.wrappedKey, "base64"));
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(`${projectRef}:${envelope.recoveryId}`));
    decipher.setAuthTag(ciphertext.subarray(-16));
    const values = JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString());
    const digests = await expectedDigests(projectRef);
    if (Object.keys(values).sort().join(",") !== [...names].sort().join(",")) throw new Error("RECOVERY_SECRET_NAMES_INVALID");
    for (const name of names) {
      if (typeof values[name] !== "string" || /[\r\n]/.test(values[name]) || hash(values[name]) !== digests[name]) throw new Error("RECOVERY_DIGEST_MISMATCH");
    }
    await writeFile(".secrets/production-public-order-recovered.env", names.map((name) => `PRIMARY_${name}=${values[name]}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ event: "original_public_order_secrets_recovered", secretNames: names, digestsMatched: true }));
  } else throw new Error("RECOVERY_MODE_INVALID");
} catch (error) {
  console.error(JSON.stringify({ event: "public_order_secret_recovery_failed", reason: /^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "RECOVERY_FAILED" }));
  process.exitCode = 1;
}

async function recover(projectRef, recipientPublicKey, digests) {
  const recoveryId = randomUUID();
  const functionName = `recover-public-order-${randomBytes(8).toString("hex")}`;
  const functions = await management(`/v1/projects/${projectRef}/functions`);
  if (functions.some((fn) => (fn.slug ?? fn.name) === functionName)) throw new Error("RECOVERY_FUNCTION_ALREADY_EXISTS");
  const keys = await management(`/v1/projects/${projectRef}/api-keys?reveal=true`);
  const serviceKey = keys.find((key) => key.name === "service_role")?.api_key;
  if (!serviceKey || serviceKey.split(".").length !== 3) throw new Error("RECOVERY_SERVICE_JWT_UNAVAILABLE");
  setSecret(serviceKey);
  const nonce = randomBytes(32).toString("hex");
  setSecret(nonce);
  const createdAt = Date.now();
  const config = { projectRef, recoveryId, recipientPublicKey, digests, serviceAuthorizationHash: hash(`Bearer ${serviceKey}`), nonceHash: hash(nonce), createdAt, expiresAt: createdAt + 300_000 };
  const directory = await mkdtemp(join(tmpdir(), "stallorder-recovery-"));
  const sourceDirectory = join(directory, "supabase", "functions", functionName);
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(directory, "supabase", "config.toml"), `project_id = "public-order-recovery"\n[functions.${functionName}]\nverify_jwt = true\n`);
  await writeFile(join(sourceDirectory, "index.ts"), `// @ts-nocheck\n${createPublicOrderSecretRecoveryHandler.toString()}\nDeno.serve(createPublicOrderSecretRecoveryHandler(${JSON.stringify(config)}, { getEnv: (name) => Deno.env.get(name) }));\n`);
  const cli = resolve("node_modules/supabase/dist/supabase.js");
  let envelope;
  try {
    runNode(cli, ["functions", "deploy", functionName, "--project-ref", projectRef, "--workdir", directory, "--use-api"], 150_000);
    const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/${functionName}`, {
      method: "POST", headers: { authorization: `Bearer ${serviceKey}`, "x-recovery-nonce": nonce }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`RECOVERY_INVOKE_FAILED_HTTP_${response.status}`);
    envelope = await response.json();
    if (envelope.projectRef !== projectRef || envelope.recoveryId !== recoveryId || envelope.schemaVersion !== 1) throw new Error("RECOVERY_RESPONSE_INVALID");
  } finally {
    // Delete only this random function, including after an uncertain deploy response.
    runNode(cli, ["functions", "delete", functionName, "--project-ref", projectRef, "--yes"], 60_000);
    const remaining = await management(`/v1/projects/${projectRef}/functions`);
    if (remaining.some((fn) => (fn.slug ?? fn.name) === functionName)) throw new Error("RECOVERY_FUNCTION_CLEANUP_FAILED");
    console.log(JSON.stringify({ event: "public_order_recovery_function_deleted", projectRef, functionName, functionDeleted: true }));
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/public-order-secret-envelope.json", JSON.stringify({ ...envelope, functionName, functionDeleted: true, digests, recoveredAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ event: "encrypted_public_order_recovery_complete", projectRef, functionName, functionDeleted: true }));
}

async function expectedDigests(projectRef) {
  const listed = await management(`/v1/projects/${projectRef}/secrets`);
  return Object.fromEntries(names.map((name) => {
    const value = listed.find((secret) => secret.name === name)?.value;
    if (!/^[a-f0-9]{64}$/.test(value ?? "")) throw new Error("RECOVERY_CANONICAL_DIGEST_UNAVAILABLE");
    return [name, value];
  }));
}
async function management(path) {
  const response = await fetch(`https://api.supabase.com${path}`, { headers: { authorization: `Bearer ${required("SUPABASE_ACCESS_TOKEN")}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("RECOVERY_MANAGEMENT_READ_FAILED");
  return response.json();
}
function runNode(script, args, timeout = 30_000) {
  try { execFileSync(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"], timeout }); }
  catch { throw new Error(script.endsWith("production-approval.mjs") ? "RECOVERY_PLAN_VERIFICATION_FAILED" : "RECOVERY_FUNCTION_OPERATION_FAILED"); }
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}
