import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { allowsTurnstileCsp } from "./production-smoke-csp.mjs";

const origin = "https://challenges.cloudflare.com";

describe("Turnstile CSP release smoke", () => {
  it.each([
    `default-src 'self'; script-src 'self' 'nonce-synthetic' ${origin}; frame-src ${origin}`,
    `default-src 'self' ${origin}`,
    `default-src 'none'; script-src ${origin}; child-src ${origin}`,
    `script-src 'none'; script-src-elem ${origin}; frame-src ${origin}/`,
    `SCRIPT-SRC ${origin}; FRAME-SRC ${origin}`,
  ])("accepts exact script/frame sources and their CSP fallbacks: %s", policy => {
    expect(allowsTurnstileCsp(policy)).toBe(true);
  });

  it.each([
    `script-src ${origin}.evil.test; frame-src ${origin}.evil.test`,
    `script-src ${origin}?fake=1; frame-src ${origin}`,
    `script-src ${origin}#fake; frame-src ${origin}`,
    `script-src https://challenges.cloudflare.com@evil.test; frame-src ${origin}`,
    `connect-src ${origin}; script-src 'self'; frame-src 'self'`,
    `default-src ${origin}; script-src 'self'`,
    `default-src ${origin}; frame-src 'none'`,
    `script-src ${origin}; script-src-elem 'self'; frame-src ${origin}`,
    `script-src ${origin}; child-src 'none'`,
    `script-src ${origin}; frame-src ${origin}; SCRIPT-SRC ${origin}`,
    `default-src ${origin}, default-src ${origin}`,
    `script-src 'nonce-synthetic' 'strict-dynamic' ${origin}; frame-src ${origin}`,
    "", null,
  ])("rejects ineffective, ambiguous or disguised policy: %s", policy => {
    expect(allowsTurnstileCsp(policy)).toBe(false);
  });

  it.each([
    [`script-src ${origin}.evil.test; frame-src ${origin}.evil.test`, "FAIL"],
    [`connect-src ${origin}; script-src 'self'; frame-src 'self'`, "FAIL"],
    [`script-src 'self' 'nonce-synthetic' ${origin}; frame-src ${origin}`, "PASS"],
  ])("runs the actual smoke callsite without external requests: %s", (policy, status) => {
    // Both old negative cases passed the historical whole-header substring check.
    expect(policy.includes(origin)).toBe(true);
    const program = `
      const policy = ${JSON.stringify(policy)};
      globalThis.fetch = async target => {
        const path = new URL(target).pathname;
        if (path === '/') return new Response('<script src="/_next/static/synthetic.js"></script>', {headers:{
          'content-security-policy': policy + "; frame-ancestors 'none'",
          'x-content-type-options':'nosniff','referrer-policy':'strict-origin',
          'permissions-policy':'camera=()','strict-transport-security':'max-age=31536000'}});
        if (path === '/api/connectivity') return new Response('', {headers:{'x-service-state':'ready'}});
        if (path === '/api/health' || path.startsWith('/api/merchant/')) return new Response('', {status:401});
        return new Response('synthetic');
      };
      await import('./scripts/production-smoke-test.mjs');
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PRODUCTION_BASE_URL: "https://synthetic.invalid", SMOKE_SKIP_DOMAIN_REDIRECTS: "true",
        PRODUCTION_TEST_QR_REQUIRED: "false", PRODUCTION_TEST_QR_URL: "", VERCEL_AUTOMATION_BYPASS_SECRET: "" },
    });
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain(`${status}: CSP allows Turnstile`);
    expect(result.status).toBe(status === "PASS" ? 0 : 1);
  });
});
