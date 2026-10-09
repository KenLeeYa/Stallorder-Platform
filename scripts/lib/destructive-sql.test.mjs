import { describe, expect, it } from "vitest";
import { hasBlockingDestructiveSql } from "./destructive-sql.mjs";
describe("destructive migration gate", () => {
  it("accepts an audit event guard and privilege removal without executing truncation", () => {
    expect(hasBlockingDestructiveSql("CREATE TRIGGER audit_guard BEFORE TRUNCATE ON public.audit_logs FOR EACH STATEMENT EXECUTE FUNCTION reject(); REVOKE DELETE, TRUNCATE ON public.audit_logs FROM service_role;")).toBe(false);
  });
  it.each(["TRUNCATE public.orders;", "truncate table public.orders;", "DROP TABLE public.orders;", "DO $$ BEGIN EXECUTE 'TRUNCATE public.orders'; END $$;",
    "CREATE TRIGGER g BEFORE TRUNCATE ON public.audit_logs FOR EACH STATEMENT EXECUTE FUNCTION reject(); TRUNCATE public.orders;",
    "REVOKE TRUNCATE ON public.audit_logs FROM service_role; TRUNCATE public.orders;",
    "ALTER TABLE public.orders ALTER COLUMN total TYPE text;"])("still blocks actual destructive statements: %s", (sql) => {
    expect(hasBlockingDestructiveSql(sql)).toBe(true);
  });
});
