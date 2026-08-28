import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260828180000_employee_location_attendance.sql"),
  "utf8",
);

describe("employee location attendance migration", () => {
  it("keeps attendance tables backend-only and tenant scoped", () => {
    expect(migration).toContain("create table public.attendance_policies");
    expect(migration).toContain("create table public.attendance_events");
    expect(migration).toContain("force row level security");
    expect(migration).toContain("revoke all on table public.attendance_events from public, anon, authenticated");
    expect(migration).toContain("organization_id uuid not null");
    expect(migration).toContain("stall_id uuid not null");
    expect(migration).toContain("attendance_policies_stall_scope_fkey");
    expect(migration).toContain("attendance_events_stall_scope_fkey");
    expect(migration).toContain("references public.stalls(id, organization_id)");
  });

  it("constrains geofence policy and minimizes expired location evidence", () => {
    expect(migration).toContain("radius_meters between 50 and 500");
    expect(migration).toContain("max_accuracy_meters between 20 and 200");
    expect(migration).toContain("purge_expired_attendance_location_evidence");
    expect(migration).toContain("latitude = null");
    expect(migration).toContain("session_id = null");
  });
});
