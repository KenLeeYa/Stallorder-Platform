import { expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { assertPreviewFixtureUnchanged, preparePreviewFixture, restorePreviewFixture, type PreviewFixtureState } from "./qa-preview-fixture-state";

const original = {
  hours: [{ id: "owned-hour", day_of_week: 0, opens_at: "00:00", updated_at: "2026-11-05T06:00:00.123456+00:00" }],
  printers: [{ id: "owned-printer", is_enabled: false, updated_at: "2026-11-05T06:00:00.123456+00:00" }],
};

it("accepts only a complete unchanged fixture postimage", () => {
  expect(() => assertPreviewFixtureUnchanged(structuredClone(original), original)).not.toThrow();
});

it("rejects a concurrent edit, microsecond-only change, added row or missing row", () => {
  const edits = [
    { ...original, hours: [{ ...original.hours[0], opens_at: "14:00" }] },
    { ...original, hours: [{ ...original.hours[0], updated_at: "2026-11-05T06:00:00.123457+00:00" }] },
    { ...original, printers: [{ ...original.printers[0], is_enabled: true }] },
    { ...original, printers: [...original.printers, { ...original.printers[0], id: "foreign" }] },
    { ...original, hours: [] },
  ];
  for (const changed of edits) expect(() => assertPreviewFixtureUnchanged(changed, original)).toThrow("PREVIEW_FIXTURE_CHANGED");
});

function uncertainTransaction(committed: boolean) {
  const before = { hours: Array.from({ length: 7 }, (_, day_of_week) => ({ ...original.hours[0], id: String(day_of_week), day_of_week, opens_at: "09:00" })), printers: [{ ...original.printers[0], is_enabled: true }] };
  let current = structuredClone(before);
  let first = true;
  let writes = 0;
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray) => (sql.join("").includes("business_hours") ? current.hours : current.printers).map(row => ({ row: structuredClone(row) })),
    $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      writes++;
      const hours = sql.join("").includes("business_hours");
      if (sql.join("").includes("jsonb_populate_recordset")) {
        if (hours) current.hours = JSON.parse(values[0] as string);
        else current.printers = JSON.parse(values[0] as string);
      } else if (hours) current.hours = current.hours.map(row => ({ ...row, opens_at: "00:00" }));
      else current.printers = current.printers.map(row => ({ ...row, is_enabled: false }));
      return hours ? current.hours.length : current.printers.length;
    },
  };
  const db = { $transaction: async (action: (value: typeof tx) => Promise<unknown>) => {
    const result = await action(tx);
    if (first) { first = false; if (!committed) current = structuredClone(before); throw new Error("CONNECTION_LOST_AFTER_CALLBACK"); }
    return result;
  } } as unknown as PrismaClient;
  return { db, before, get current() { return current; }, get writes() { return writes; } };
}

it.each([true, false])("retains recovery state when transaction outcome is unknown (committed=%s)", async committed => {
  const fixture = uncertainTransaction(committed);
  let state: PreviewFixtureState | undefined;
  await expect(preparePreviewFixture(fixture.db, prepared => { state = prepared; })).rejects.toThrow("CONNECTION_LOST_AFTER_CALLBACK");
  expect(state).toBeDefined();
  await restorePreviewFixture(fixture.db, state!);
  expect(fixture.current).toEqual(fixture.before);
  expect(fixture.writes).toBe(committed ? 4 : 2);
});

it("preserves a foreign post-commit edit after an uncertain preparation", async () => {
  const fixture = uncertainTransaction(true);
  let state: PreviewFixtureState | undefined;
  await expect(preparePreviewFixture(fixture.db, prepared => { state = prepared; })).rejects.toThrow("CONNECTION_LOST_AFTER_CALLBACK");
  expect(state).toBeDefined();
  fixture.current.hours[0].opens_at = "14:00";
  await expect(restorePreviewFixture(fixture.db, state!)).rejects.toThrow("PREVIEW_FIXTURE_CHANGED");
  expect(fixture.current.hours[0].opens_at).toBe("14:00");
  expect(fixture.writes).toBe(2);
});
