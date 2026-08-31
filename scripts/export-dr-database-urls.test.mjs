import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = [...process.argv];
const managedEnvironmentNames = [
  "GITHUB_ENV",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
  "PRIMARY_SUPABASE_PROJECT_REF",
  "DR_SUPABASE_PROJECT_REF",
  "DR_SUPABASE_DB_PASSWORD",
  "PRIMARY_REPLICATION_PASSWORD",
];
const originalEnvironment = Object.fromEntries(
  managedEnvironmentNames.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArgv);
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Supabase database URL export", () => {
  it("exports only a short-lived JIT session URL in primary-only mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stallorder-jit-url-"));
    const githubEnvironment = join(directory, "github-env");
    const projectRef = "abcdefghijklmnopqrst";
    const accessToken = "test-access-token";
    const userId = "123e4567-e89b-12d3-a456-426614174000";

    process.argv.splice(
      0,
      process.argv.length,
      process.execPath,
      "scripts/export-dr-database-urls.mjs",
      "--primary-only",
    );
    process.env.GITHUB_ENV = githubEnvironment;
    process.env.SUPABASE_ACCESS_TOKEN = accessToken;
    process.env.SUPABASE_PROJECT_REF = projectRef;
    delete process.env.PRIMARY_SUPABASE_PROJECT_REF;
    delete process.env.DR_SUPABASE_PROJECT_REF;
    delete process.env.DR_SUPABASE_DB_PASSWORD;
    delete process.env.PRIMARY_REPLICATION_PASSWORD;

    const fetchMock = vi.fn(async (input, init = {}) => {
      const url = new URL(input);
      const response = (body) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      expect(init.headers.Authorization).toBe(`Bearer ${accessToken}`);
      if (url.pathname === "/v1/profile") {
        return response({ gotrue_id: userId });
      }
      if (url.pathname === `/v1/projects/${projectRef}/jit-access`) {
        return response({ state: "enabled", appliedSuccessfully: true });
      }
      if (url.pathname === `/v1/projects/${projectRef}/database/jit/list`) {
        return response({ items: [] });
      }
      if (
        url.pathname === `/v1/projects/${projectRef}/database/jit` &&
        init.method === "PUT"
      ) {
        const body = JSON.parse(init.body);
        return response({
          user_id: body.user_id,
          user_roles: body.roles,
        });
      }
      if (
        url.pathname ===
        `/v1/projects/${projectRef}/config/database/pooler`
      ) {
        return response([
          {
            database_type: "PRIMARY",
            connection_string:
              `postgresql://postgres.${projectRef}` +
              "@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
          },
        ]);
      }
      if (url.pathname === `/v1/projects/${projectRef}`) {
        return response({
          database: { host: `db.${projectRef}.supabase.co` },
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await import("./export-dr-database-urls.mjs");

      const lines = (await readFile(githubEnvironment, "utf8"))
        .trim()
        .split(/\r?\n/);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^SUPABASE_CI_DATABASE_URL=/);

      const databaseUrl = new URL(
        lines[0].slice("SUPABASE_CI_DATABASE_URL=".length),
      );
      expect(decodeURIComponent(databaseUrl.username)).toBe(
        `postgres.${projectRef}`,
      );
      expect(decodeURIComponent(databaseUrl.password)).toBe(accessToken);
      expect(databaseUrl.hostname).toBe(
        "aws-0-ap-northeast-1.pooler.supabase.com",
      );
      expect(databaseUrl.port).toBe("5432");
      expect(databaseUrl.searchParams.get("sslmode")).toBe("require");
      expect(databaseUrl.searchParams.get("connect_timeout")).toBe("10");
      expect(databaseUrl.searchParams.get("options")).toBe("-c jit=true");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exports DR direct and runtime access without touching Primary JIT in DR-only mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stallorder-dr-url-"));
    const githubEnvironment = join(directory, "github-env");
    const projectRef = "zyxwvutsrqponmlkjihg";
    const accessToken = "test-access-token";
    const drPassword = "test-dr-password";

    process.argv.splice(
      0,
      process.argv.length,
      process.execPath,
      "scripts/export-dr-database-urls.mjs",
      "--dr-only",
    );
    process.env.GITHUB_ENV = githubEnvironment;
    process.env.SUPABASE_ACCESS_TOKEN = accessToken;
    process.env.DR_SUPABASE_PROJECT_REF = projectRef;
    process.env.DR_SUPABASE_DB_PASSWORD = drPassword;
    delete process.env.SUPABASE_PROJECT_REF;
    delete process.env.PRIMARY_SUPABASE_PROJECT_REF;
    delete process.env.PRIMARY_REPLICATION_PASSWORD;

    const requestedPaths = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
      const url = new URL(input);
      requestedPaths.push(url.pathname);
      expect(init.headers.Authorization).toBe(`Bearer ${accessToken}`);
      const response = (body) => new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      if (
        url.pathname ===
        `/v1/projects/${projectRef}/config/database/pooler`
      ) {
        return response([{
          database_type: "PRIMARY",
          connection_string:
            `postgresql://postgres.${projectRef}`
            + "@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
        }]);
      }
      if (url.pathname === `/v1/projects/${projectRef}`) {
        return response({ database: { host: `db.${projectRef}.supabase.co` } });
      }
      return new Response(null, { status: 404 });
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await import("./export-dr-database-urls.mjs?dr-only-test");
      const lines = (await readFile(githubEnvironment, "utf8"))
        .trim()
        .split(/\r?\n/);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^DR_DIRECT_URL=/);
      const databaseUrl = new URL(lines[0].slice("DR_DIRECT_URL=".length));
      expect(decodeURIComponent(databaseUrl.username)).toBe(`postgres.${projectRef}`);
      expect(decodeURIComponent(databaseUrl.password)).toBe(drPassword);
      expect(databaseUrl.port).toBe("5432");
      expect(databaseUrl.searchParams.get("sslmode")).toBe("require");
      expect(lines[1]).toMatch(/^DR_RUNTIME_DATABASE_URL=/);
      const runtimeUrl = new URL(
        lines[1].slice("DR_RUNTIME_DATABASE_URL=".length),
      );
      expect(runtimeUrl.port).toBe("6543");
      expect(runtimeUrl.searchParams.get("pgbouncer")).toBe("true");
      expect(requestedPaths).not.toContain("/v1/profile");
      expect(requestedPaths.every((path) => !path.includes("/jit"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
