import { describe, expect, it } from "vitest";
import { localLinePreviewAllowed } from "./local-line-preview";
describe("local LINE mock boundary", () => {
  it("permits only explicit local environment with a loopback database", () => {
    expect(localLinePreviewAllowed({ APP_ENV: "local", DATABASE_URL: "postgres://demo:demo@127.0.0.1:56822/postgres" })).toBe(true);
    const lab = { APP_ENV: "test", VERCEL_ENV: "preview", RESPONSIVE_QA_RUN: "true", APP_BASE_URL: "http://127.0.0.1:3026", DATABASE_URL: "postgres://demo:demo@127.0.0.1:56822/postgres" };
    expect(localLinePreviewAllowed(lab)).toBe(true);
    expect(localLinePreviewAllowed({ ...lab, VERCEL: "1" })).toBe(false);
    expect(localLinePreviewAllowed({ ...lab, RESPONSIVE_QA_RUN: "false" })).toBe(false);
    expect(localLinePreviewAllowed({ ...lab, APP_BASE_URL: "https://app.qidaigo.com" })).toBe(false);
    for (const DATABASE_URL of ["postgres://localhost:56822/postgres", "postgres://127.0.0.1:5432/postgres", "postgres://127.0.0.1:56822/production", "postgres://db.example.com:56822/postgres"]) expect(localLinePreviewAllowed({ ...lab, DATABASE_URL })).toBe(false);
    expect(localLinePreviewAllowed({ ...lab, VERCEL_ENV: "production" })).toBe(false);
    expect(localLinePreviewAllowed({ ...lab, APP_ENV: "production" })).toBe(false);
    for (const environment of [
      { APP_ENV: "production", DATABASE_URL: "postgres://localhost/postgres" },
      { APP_ENV: "local", VERCEL_ENV: "preview", DATABASE_URL: "postgres://localhost/postgres" },
      { APP_ENV: "local", DATABASE_URL: "postgres://localhost.example.com/postgres" },
      { APP_ENV: "local", DATABASE_URL: "not-a-url" },
    ]) expect(localLinePreviewAllowed(environment)).toBe(false);
  });
});
