import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import type { PrismaClient } from "@prisma/client";

const organization = "11111111-1111-4111-8111-111111111111";
const stall = "22222222-2222-4222-8222-222222222222";
type Row = Record<string, unknown>;
type Snapshot = { hours: Row[]; printers: Row[] };
type Reader = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;
export type PreviewFixtureState = { before: Snapshot; after: Snapshot };

// JSONB retains PostgreSQL timestamp precision; Prisma Date values would round
// the existing microseconds before restoring the borrowed fixture metadata.
async function snapshot(db: Reader): Promise<Snapshot> {
  const hours = await db.$queryRaw<{ row: Row }[]>`
    select to_jsonb(h) as row from public.stall_business_hours h
    where organization_id=${organization}::uuid and stall_id=${stall}::uuid
    order by day_of_week for update`;
  const printers = await db.$queryRaw<{ row: Row }[]>`
    select to_jsonb(p) as row from public.printers p
    where organization_id=${organization}::uuid and stall_id=${stall}::uuid
    order by id for update`;
  return { hours: hours.map(value => value.row), printers: printers.map(value => value.row) };
}

export function assertPreviewFixtureUnchanged(actual: Snapshot, expected: Snapshot) {
  assert.deepEqual(actual, expected, "PREVIEW_FIXTURE_CHANGED");
}

export async function preparePreviewFixture(db: PrismaClient, preserveState: (state: PreviewFixtureState) => void): Promise<PreviewFixtureState> {
  return db.$transaction(async tx => {
    const before = await snapshot(tx);
    assert.equal(before.hours.length, 7, "PREVIEW_FIXTURE_HOURS_INVALID");
    assert.deepEqual(before.hours.map(row => row.day_of_week), [0, 1, 2, 3, 4, 5, 6]);
    await tx.$executeRaw`
      update public.stall_business_hours set opens_at='00:00', closes_at='00:00',
        last_order_at=null, is_closed=false, updated_at=now()
      where organization_id=${organization}::uuid and stall_id=${stall}::uuid`;
    await tx.$executeRaw`
      update public.printers set is_enabled=false, updated_at=now()
      where organization_id=${organization}::uuid and stall_id=${stall}::uuid`;
    const state = { before, after: await snapshot(tx) };
    // Preserve both images before COMMIT: a disconnected client may never
    // receive the successful transaction result. Cleanup resolves the outcome.
    preserveState(state);
    return state;
  }, { isolationLevel: "Serializable" });
}

export async function restorePreviewFixture(db: PrismaClient, state: PreviewFixtureState) {
  await db.$transaction(async tx => {
    // Refuse concurrent changes before restoring any row. All rows are locked
    // within this serializable transaction, and a conflict rolls it all back.
    const actual = await snapshot(tx);
    if (isDeepStrictEqual(actual, state.before)) return;
    assertPreviewFixtureUnchanged(actual, state.after);
    const hours = await tx.$executeRaw`
      update public.stall_business_hours h set opens_at=b.opens_at, closes_at=b.closes_at,
        last_order_at=b.last_order_at, is_closed=b.is_closed, updated_at=b.updated_at
      from jsonb_populate_recordset(null::public.stall_business_hours,
        ${JSON.stringify(state.before.hours)}::jsonb) b
      where h.id=b.id and h.organization_id=${organization}::uuid and h.stall_id=${stall}::uuid`;
    const printers = await tx.$executeRaw`
      update public.printers p set is_enabled=b.is_enabled, updated_at=b.updated_at
      from jsonb_populate_recordset(null::public.printers,
        ${JSON.stringify(state.before.printers)}::jsonb) b
      where p.id=b.id and p.organization_id=${organization}::uuid and p.stall_id=${stall}::uuid`;
    assert.equal(hours, state.before.hours.length, "PREVIEW_FIXTURE_RESTORE_COUNT");
    assert.equal(printers, state.before.printers.length, "PREVIEW_FIXTURE_RESTORE_COUNT");
    assertPreviewFixtureUnchanged(await snapshot(tx), state.before);
  }, { isolationLevel: "Serializable" });
}
