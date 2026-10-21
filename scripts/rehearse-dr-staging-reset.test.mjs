import { describe, expect, it } from "vitest";
import { assertRehearsalTarget } from "./rehearse-dr-staging-reset.mjs";

describe("restored DR reset rehearsal boundary", () => {
  it("accepts only the disposable loopback database, never either hosted project", () => {
    expect(() => assertRehearsalTarget("postgresql://supabase_admin:example-placeholder@127.0.0.1:54322/postgres?sslmode=disable")).not.toThrow();
    for (const url of [
      "postgresql://supabase_admin:example-placeholder@127.0.0.1:55432/postgres?sslmode=disable",
      "postgresql://postgres.daeqwtpaxcebmtwxqdkj:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
      "postgresql://postgres.eyuctbnlvnbnivwasvqr:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
      "postgresql://supabase_admin:example-placeholder@127.0.0.1:54322/postgres?host=evil.example&sslmode=disable",
    ]) expect(() => assertRehearsalTarget(url)).toThrow("REHEARSAL_TARGET_INVALID");
  });
});
