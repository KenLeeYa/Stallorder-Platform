import { expect, test, vi } from "vitest";
import { assertResponsiveQaTarget, createResponsiveQaClient } from "./responsive-qa-target.mjs";

const exactLocalLab = {
  RESPONSIVE_QA_RUN: "true",
  PLAYWRIGHT_APP_URL: "http://127.0.0.1:3026",
  DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:56822/postgres",
  PRIMARY_SUPABASE_URL: "http://127.0.0.1:56821",
};

test("accepts the exact isolated responsive lab", () => {
  expect(() => assertResponsiveQaTarget(exactLocalLab)).not.toThrow();
});

test("rejects retained app and DB targets", () => {
  expect(() => assertResponsiveQaTarget({ ...exactLocalLab, PLAYWRIGHT_APP_URL: "http://127.0.0.1:3023" })).toThrow();
  expect(() => assertResponsiveQaTarget({ ...exactLocalLab, APP_BASE_URL: "http://127.0.0.1:3023" })).toThrow();
  expect(() => assertResponsiveQaTarget({ ...exactLocalLab, DATABASE_URL: "postgresql://synthetic:synthetic@localhost:55722/postgres" })).toThrow();
});

test("rejects a remote database even with the local flag", () => {
  expect(() => assertResponsiveQaTarget({ ...exactLocalLab, DATABASE_URL: "postgresql://synthetic:synthetic@db.example.test:56822/postgres" })).toThrow();
});

test("rejects a missing flag or mismatched primary API", () => {
  expect(() => assertResponsiveQaTarget({ ...exactLocalLab, RESPONSIVE_QA_RUN: undefined })).toThrow();
  expect(() => assertResponsiveQaTarget({ ...exactLocalLab, PRIMARY_SUPABASE_URL: "http://127.0.0.1:55721" })).toThrow();
});

test("pickup fixture refuses a wrong database before creating a client or making DB calls", () => {
  const dbCall = vi.fn();
  const createClient = vi.fn(() => ({ stall: { create: dbCall } }));
  expect(() => createResponsiveQaClient({
    ...exactLocalLab,
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost:55722/postgres",
  }, createClient)).toThrow("RESPONSIVE_QA_TARGET_INVALID: database");
  expect(createClient).not.toHaveBeenCalled();
  expect(dbCall).not.toHaveBeenCalled();
});
