import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function classifyPreviewDbProbe(output) {
  if (typeof output !== "string" || output.length > 65_536) return "UNCLASSIFIED";
  if (/timed?\s*out|timeout/i.test(output)) return "TIMEOUT";
  if (/password authentication failed|authentication failed|invalid password/i.test(output)) return "AUTHENTICATION";
  if (/tenant.*not found|tenant or user not found/i.test(output)) return "TENANT_NOT_FOUND";
  if (/no such host|ENOTFOUND|EAI_AGAIN|name resolution/i.test(output)) return "DNS";
  if (/connection refused|ECONNREFUSED/i.test(output)) return "CONNECTION_REFUSED";
  if (/too many connections|remaining connection slots/i.test(output)) return "CONNECTION_LIMIT";
  return "UNCLASSIFIED";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error("PREVIEW_DB_PROBE_DIAGNOSTIC", JSON.stringify({
    category: classifyPreviewDbProbe(readFileSync(0, "utf8")),
  }));
}
