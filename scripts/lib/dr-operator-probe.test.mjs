import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as entry from "./dr-operator-entry.mjs";

const exec = promisify(execFile);
const source = readFileSync(new URL("../manage-dr-operator-entry.mjs", import.meta.url), "utf8");
const probeSource = source.slice(
  source.indexOf("async function vercelCurl"),
  source.indexOf("async function cloudflareAccessProbe"),
);
const responses = {
  "/ready": [200, "application/json; charset=utf-8", '{"status":"READY"}'],
  "/denied": [403, "", ""],
  "/redirect": [307, "", ""],
  "/blocked": [503, "application/json", '{"status":"BLOCKED"}'],
  "/html": [200, "text/html", '<html>private-provider-response</html>'],
  "/invalid": [200, "application/json", 'private-invalid-json'],
};
const server = createServer((request, response) => {
  const [status, type, body] = responses[request.url];
  response.writeHead(status, {
    ...(type ? { "content-type": type } : {}),
    ...(status === 307 ? { location: "/ready?secret=private-redirect-token" } : {}),
  });
  response.end(body);
});
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function probe(path) {
  const runVercel = async (args, _errorCode, projectId) => {
    expect(projectId).toBe("prj_drfixture");
    expect(args.slice(0, 6)).toEqual(["curl", path, "--deployment", baseUrl, "--yes", ...(args.length > 5 ? ["--"] : [])]);
    const separator = args.indexOf("--");
    const flags = separator < 0 ? [] : args.slice(separator + 1);
    const { stdout } = await exec("curl", ["--url", `${baseUrl}${path}`, ...flags]);
    return stdout;
  };
  const invoke = new Function("runVercel", "planProbePath", "parseDrOperatorProbeOutput", `${probeSource}\nreturn vercelCurl;`)(
    runVercel, () => path, entry.parseDrOperatorProbeOutput,
  );
  return invoke(baseUrl, "prj_drfixture");
}

describe("generated DR deployment probe through the actual curl response", () => {
  it("returns the successful JSON payload", async () => {
    await expect(probe("/ready")).resolves.toEqual({ status: "READY" });
  });

  it.each([["/denied", 403], ["/redirect", 307], ["/blocked", 503]])(
    "rejects %s by HTTP status without following redirects or accepting error JSON",
    async (path, status) => {
      await expect(probe(path)).rejects.toMatchObject({
        message: `DR_ENTRY_PROBE_HTTP_${status}`,
        failureStage: "PROBE_GENERATED_DEPLOYMENT",
        probeHttpStatus: status,
      });
    },
  );

  it.each([["/html", "CONTENT_TYPE_INVALID"], ["/invalid", "JSON_INVALID"]])(
    "rejects %s without including response content in diagnostics",
    async (path, reason) => {
      const error = await probe(path).catch((value) => value);
      expect(error.message).toBe(`DR_ENTRY_PROBE_${reason}`);
      expect(error.probeHttpStatus).toBe(200);
      expect(JSON.stringify(error)).not.toContain("private");
    },
  );

  it("rejects missing transport metadata even if the body claims READY", () => {
    expect(() => entry.parseDrOperatorProbeOutput('{"status":"READY"}'))
      .toThrow("DR_ENTRY_PROBE_TRANSPORT_METADATA_MISSING");
  });
});
