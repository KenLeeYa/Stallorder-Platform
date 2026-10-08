import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const [sourceDirectory, output] = process.argv.slice(2);
if (!sourceDirectory || !output) throw Error("Expected source directory and output file");
process.chdir(sourceDirectory);
const { readResponsiveBuildProvenance } = await import(pathToFileURL(path.resolve("scripts/responsive-build-provenance.mjs")));
const source = readResponsiveBuildProvenance();
const routes = ["q/[qrToken]/page", "staff/[stallSlug]/page", "kitchen/page", "merchant/reports/overview/page"];
const results = routes.map(route => {
  const context = { globalThis: {} };
  const manifestPath = path.join(".next/server/app", `${route}_client-reference-manifest.js`);
  vm.runInNewContext(readFileSync(manifestPath, "utf8"), context);
  const manifest = context.globalThis.__RSC_MANIFEST[`/${route}`];
  const chunks = [...new Set(manifest.entryJSFiles[`[project]/src/app/${route}`])].map(file => {
    const location = path.join(".next", file);
    const bytes = readFileSync(location);
    return { file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  return { route, totalBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0), chunks };
});
const shared = results[0].chunks.filter(chunk => results.every(route => route.chunks.some(other => other.file === chunk.file)));
writeFileSync(output, JSON.stringify({ source, unit: "uncompressed entry JS bytes", routes: results, sharedAcrossFourRoutes: shared, sharedBytes: shared.reduce((sum, chunk) => sum + chunk.bytes, 0) }, null, 2) + "\n");
