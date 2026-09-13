import dns from "node:dns";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as entry from "./dr-operator-entry.mjs";

const source = readFileSync(new URL("../manage-dr-operator-entry.mjs", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const functions = [
  section("async function cloudflareAccessProbe", "function assertProbeReady"),
  section("async function assertProtected", "async function waitForRecommendedCname"),
  section("async function waitForDirectVercelTls", "async function retireLegacyStaging"),
].join("\n");
const nativeLookup = dns.lookup;
const nativeFetch = globalThis.fetch;
const credentials = { serviceTokenClientId: "fixture-client", serviceTokenClientSecret: "fixture-secret" };
let port;
let lookupCount;
let edgeAvailableAtLookup;
let edgeStatus;
let edgeHeaders;
let requests;
let elapsedMs;
let dnsCacheExpiresAt;

const origin = createServer((request, response) => {
  requests.push({ target: "origin", credential: request.headers["cf-access-client-secret"] });
  response.writeHead(403, { "cache-control": "no-store", "x-vercel-id": "fixture", server: "Vercel" });
  response.end();
});
const edge = createServer((request, response) => {
  const credential = request.headers["cf-access-client-secret"];
  requests.push({ target: "edge", credential });
  const status = credential ? edgeStatus : 302;
  response.writeHead(status, {
    server: "cloudflare", "cf-ray": "0123456789abcdef-TPE", "cache-control": "no-store",
    "content-type": "application/json", ...edgeHeaders,
  });
  response.end(status === 200 ? '{"status":"READY"}' : "private-response-not-for-evidence");
});

beforeAll(async () => {
  await new Promise((resolve) => origin.listen(0, "127.0.0.1", resolve));
  port = origin.address().port;
  await new Promise((resolve) => edge.listen(port, "127.0.0.2", resolve));
});
afterAll(async () => {
  await Promise.all([origin, edge].map((server) => new Promise((resolve) => server.close(resolve))));
});
beforeEach(() => {
  lookupCount = 0;
  edgeAvailableAtLookup = 2;
  edgeStatus = 200;
  edgeHeaders = {};
  requests = [];
  elapsedMs = 0;
  dnsCacheExpiresAt = null;
  vi.spyOn(dns, "lookup").mockImplementation((hostname, options, callback) => {
    if (hostname !== "dr-proxy-fixture.invalid") return nativeLookup(hostname, options, callback);
    lookupCount += 1;
    const reachedEdge = dnsCacheExpiresAt === null
      ? lookupCount >= edgeAvailableAtLookup
      : elapsedMs >= dnsCacheExpiresAt;
    const address = reachedEdge ? "127.0.0.2" : "127.0.0.1";
    queueMicrotask(() => {
      if (options?.all) callback(null, [{ address, family: 4 }]);
      else callback(null, address, 4);
    });
  });
});
afterEach(async () => {
  origin.closeAllConnections();
  edge.closeAllConnections();
  await nextTurn();
  vi.restoreAllMocks();
});

function probes() {
  // Use the real fetch connection pool and real loopback TCP sockets. Only TLS and DNS
  // are replaced: this fixture exercises the transport transition, not certificates.
  const fetch = async (url, options) => {
    const local = new URL(url);
    local.protocol = "http:";
    return nativeFetch(local, options);
  };
  return new Function("fetch", "planProbePath", "classifyDirectVercelTlsResponse", "delay",
    `${functions}\nreturn {waitForDirectVercelTls, waitForProtectedDomain, cloudflareAccessProbe};`)(
    fetch, () => "/api/health/dr/operator", entry.classifyDirectVercelTlsResponse,
    async (milliseconds) => { elapsedMs += milliseconds; await nextTurn(); },
  );
}

async function createDnsRecord(readback = {}) {
  const create = section("    const drDnsRecord = await cloudflare(", "    await waitForDomainConfigured");
  return new Function("cloudflare", "plan", "cloudflareZoneId", "configuredTarget",
    `return (async () => { let drDnsRecordId; ${create}; return drDnsRecord; })();`)(
    async (_path, options) => ({ id: "fixture-dns", ...JSON.parse(options.body), ...readback }),
    { target: { hostname: "dr-proxy-fixture.invalid", dnsOnlyTtlSeconds: entry.DR_OPERATOR_ENTRY.dnsOnlyTtlSeconds } },
    "fixture-zone", "cname.vercel-dns.com",
  );
}

describe("DR direct-origin to Cloudflare proxy transport", () => {
  it("expires the created DNS-only cache within the unchanged proxy wait", async () => {
    const record = await createDnsRecord();
    // Cloudflare Auto (1) caches DNS-only answers for 300 seconds. Virtual time
    // advances only through the actual production retry delays; TCP stays real.
    dnsCacheExpiresAt = (record.ttl === 1 ? 300 : record.ttl) * 1000;
    const probe = probes();
    const hostname = `dr-proxy-fixture.invalid:${port}`;
    await probe.waitForDirectVercelTls(hostname);
    await expect(probe.waitForProtectedDomain(`https://${hostname}`)).resolves.toBe(302);
    await expect(probe.cloudflareAccessProbe(`https://${hostname}`, credentials))
      .resolves.toEqual({ status: "READY" });
    expect(elapsedMs).toBe(60_000);
    expect(requests.filter((request) => request.target === "origin" && request.credential)).toEqual([]);
  });

  it.each([1, 300, null])("rejects a DNS-only TTL readback of %s before TLS or proxying", async (ttl) => {
    await expect(createDnsRecord({ ttl })).rejects.toThrow("DR_ENTRY_DNS_CREATE_INVALID");
  });

  it.each([2, 4])("waits for fresh edge ingress before credentials (DNS lookup %s)", async (readyLookup) => {
    edgeAvailableAtLookup = readyLookup;
    const probe = probes();
    const hostname = `dr-proxy-fixture.invalid:${port}`;
    await expect(probe.waitForDirectVercelTls(hostname)).resolves.toMatchObject({ ready: true });
    await nextTurn(); // The completed direct-origin connection is idle before proxy enablement.
    const anonymousStatus = await probe.waitForProtectedDomain(`https://${hostname}`);
    await nextTurn();
    await expect(probe.cloudflareAccessProbe(`https://${hostname}`, credentials))
      .resolves.toEqual({ status: "READY" });
    expect(anonymousStatus).toBe(302);
    expect(requests.filter((request) => request.target === "origin" && request.credential)).toEqual([]);
    expect(requests.filter((request) => request.target === "edge" && request.credential)).toHaveLength(1);
    expect(lookupCount).toBeGreaterThanOrEqual(readyLookup);
  });

  it("does not accept a direct-origin 403 as Cloudflare protection readiness", async () => {
    edgeAvailableAtLookup = Infinity;
    await expect(probes().waitForProtectedDomain(`https://dr-proxy-fixture.invalid:${port}`))
      .rejects.toMatchObject({ message: "DR_ENTRY_CUSTOM_DOMAIN_PROTECTION_TIMEOUT" });
    expect(requests).toHaveLength(30);
    expect(requests.every((request) => !request.credential)).toBe(true);
  });

  it("retains safe transport evidence for an actual Cloudflare service-token denial", async () => {
    edgeAvailableAtLookup = 1;
    edgeStatus = 403;
    const error = await probes().cloudflareAccessProbe(`https://dr-proxy-fixture.invalid:${port}`, credentials)
      .catch((value) => value);
    expect(error).toMatchObject({
      message: "DR_ENTRY_CLOUDFLARE_ACCESS_PROBE_403", failureStage: "PROBE_CLOUDFLARE_ACCESS",
      probeHttpStatus: 403, probeReachedCloudflare: true,
    });
    expect(JSON.stringify(error)).not.toMatch(/fixture-secret|private-response|fixture-client/u);
    expect(requests).toHaveLength(1);
  });

  it.each([{ server: "Vercel" }, { "cf-ray": "" }])(
    "rejects success without confirmed Cloudflare ingress: %s", async (headers) => {
      edgeAvailableAtLookup = 1;
      edgeHeaders = headers;
      await expect(probes().cloudflareAccessProbe(`https://dr-proxy-fixture.invalid:${port}`, credentials))
        .rejects.toMatchObject({ message: "DR_ENTRY_CLOUDFLARE_INGRESS_NOT_CONFIRMED" });
    },
  );

  it("rejects a non-JSON Cloudflare response even when its body resembles readiness", async () => {
    edgeAvailableAtLookup = 1;
    edgeHeaders = { "content-type": "text/html" };
    await expect(probes().cloudflareAccessProbe(`https://dr-proxy-fixture.invalid:${port}`, credentials))
      .rejects.toMatchObject({ message: "DR_ENTRY_CLOUDFLARE_ACCESS_PROBE_INVALID", probeContentType: "HTML" });
  });
});
