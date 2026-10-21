import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const project = process.env.COMPLIANCE_REGRESSION_PROJECT === "true" ? "stallorder-compliance-regression-2026091" : "stallorder-compliance-20260913";
const container = `supabase_db_${project}`;
const database = "postgres";
const port = project.includes("regression") ? 55982 : 55992;
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|userprofile|appdata|localappdata|comspec|pathext)$/i.test(key)));
const options = { env: environment, encoding: "utf8", windowsHide: true };
const inspect = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .}}", container], options));
if (inspect.Config.Labels["com.supabase.cli.project"] !== project
  || inspect.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort !== String(port)) throw new Error("DATABASE_TEST_TARGET_MISMATCH");
const directory = resolve("supabase/tests/database");
execFileSync("docker", ["exec", container, "psql", "-X", "--set", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-c", "create extension if not exists pgtap with schema extensions"], options);
execFileSync("docker", ["exec", container, "mkdir", "-p", "/tmp/governance-tests"], options);
const names = readdirSync(directory).filter((name) => name.endsWith(".sql") && (!process.argv[2] || name.includes(process.argv[2]))).sort();
const results = [];
for (const file of names) {
  execFileSync("docker", ["cp", resolve(directory, file), `${container}:/tmp/governance-tests/${file}`], options);
  const result = spawnSync("docker", ["exec", container, "psql", "-X", "--set", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-f", `/tmp/governance-tests/${file}`], { ...options, maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const failureLines = output.split(/\r?\n/).filter((line) => /not ok|ERROR:|Looks like|No tests run|planned.*but ran/i.test(line));
  const assertions = (output.match(/^\s*ok \d+/gm) ?? []).length;
  const status = result.status === 0 && failureLines.length === 0 && assertions > 0 ? "PASS" : "FAIL";
  results.push({ file, status, assertions, failureLines });
  console.log(`${status} ${file} (${assertions})`);
}
writeFileSync(`docs/security-compliance/database-tests${process.argv[2] ? `-${process.argv[2].replace(/[^a-z0-9_-]/gi, "")}` : ""}.json`, JSON.stringify({
  observedAt: new Date().toISOString(), environment: container, database, port, productionWrites: 0, results,
}, null, 2) + "\n");
process.exitCode = results.length && results.every((result) => result.status === "PASS") ? 0 : 1;
