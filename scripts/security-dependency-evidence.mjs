import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|userprofile|appdata|localappdata|comspec|pathext)$/i.test(key)));
for (const [name, args] of [["dependency-audit.json", ["audit", "--json", "--fetch-timeout=30000"]], ["sbom.cdx.json", ["sbom", "--sbom-format", "cyclonedx", "--package-lock-only"]]]) {
  const result = spawnSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/c", "npm", ...args] : args,
    { env: environment, encoding: "utf8", windowsHide: true, timeout: 45000, maxBuffer: 30_000_000 });
  try {
    const parsed = JSON.parse(result.stdout);
    writeFileSync(`docs/security-compliance/${name}`, JSON.stringify(parsed, null, 2) + "\n");
    console.log(JSON.stringify({ file: name, exitCode: result.status, vulnerabilities: parsed.metadata?.vulnerabilities ?? null, components: parsed.components?.length ?? null }));
  } catch { throw new Error(`DEPENDENCY_EVIDENCE_UNAVAILABLE:${name}`); }
  if (result.status !== 0) process.exitCode = 1;
}
