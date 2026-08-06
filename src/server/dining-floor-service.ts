import "server-only";

import { Prisma } from "@prisma/client";
import { DEFAULT_DINING_FLOOR_NAME } from "@/lib/dining-floor";

type DiningFloorRow = {
  id: string;
  organizationId: string;
  stallId: string;
  name: string;
  sortOrder: number;
};

export class DiningFloorNotFoundError extends Error {}

export async function resolveDiningFloorIdForWrite(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    stallId: string;
    floorId: string | null;
  },
) {
  if (input.floorId) {
    const floors = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id
      from public.dining_floors
      where id = ${input.floorId}::uuid
        and organization_id = ${input.organizationId}::uuid
        and stall_id = ${input.stallId}::uuid
      for share
    `);
    if (!floors[0]) throw new DiningFloorNotFoundError();
    return floors[0].id;
  }

  return materializeDefaultDiningFloor(transaction, input);
}

export async function materializeDefaultDiningFloor(
  transaction: Prisma.TransactionClient,
  input: { organizationId: string; stallId: string },
) {
  await lockScopedStall(transaction, input);
  return materializeDefaultDiningFloorAfterLock(transaction, input);
}

export async function materializeDefaultDiningFloorForFloorCreation(
  transaction: Prisma.TransactionClient,
  input: { organizationId: string; stallId: string },
) {
  await lockScopedStall(transaction, input);
  const [state] = await transaction.$queryRaw<Array<{
    hasFloors: boolean;
    hasLegacyTables: boolean;
  }>>(Prisma.sql`
    select
      exists (
        select 1
        from public.dining_floors
        where organization_id = ${input.organizationId}::uuid
          and stall_id = ${input.stallId}::uuid
      ) as "hasFloors",
      exists (
        select 1
        from public.dining_tables
        where organization_id = ${input.organizationId}::uuid
          and stall_id = ${input.stallId}::uuid
          and floor_id is null
      ) as "hasLegacyTables"
  `);
  if (state?.hasFloors && !state.hasLegacyTables) return null;
  return materializeDefaultDiningFloorAfterLock(transaction, input);
}

async function lockScopedStall(
  transaction: Prisma.TransactionClient,
  input: { organizationId: string; stallId: string },
) {
  const stalls = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    select id
    from public.stalls
    where id = ${input.stallId}::uuid
      and organization_id = ${input.organizationId}::uuid
    for update
  `);
  if (!stalls[0]) throw new DiningFloorNotFoundError();
}

async function materializeDefaultDiningFloorAfterLock(
  transaction: Prisma.TransactionClient,
  input: { organizationId: string; stallId: string },
) {
  let [floor] = await transaction.$queryRaw<DiningFloorRow[]>(Prisma.sql`
    select
      id,
      organization_id as "organizationId",
      stall_id as "stallId",
      name,
      sort_order as "sortOrder"
    from public.dining_floors
    where organization_id = ${input.organizationId}::uuid
      and stall_id = ${input.stallId}::uuid
      and name = ${DEFAULT_DINING_FLOOR_NAME}
    order by sort_order, id
    limit 1
    for update
  `);

  if (!floor) {
    [floor] = await transaction.$queryRaw<DiningFloorRow[]>(Prisma.sql`
      insert into public.dining_floors (
        organization_id,
        stall_id,
        name,
        sort_order
      ) values (
        ${input.organizationId}::uuid,
        ${input.stallId}::uuid,
        ${DEFAULT_DINING_FLOOR_NAME},
        1
      )
      returning
        id,
        organization_id as "organizationId",
        stall_id as "stallId",
        name,
        sort_order as "sortOrder"
    `);
  }
  if (!floor) throw new DiningFloorNotFoundError();

  await transaction.$executeRaw(Prisma.sql`
    update public.dining_tables
    set floor_id = ${floor.id}::uuid,
        updated_at = now()
    where organization_id = ${input.organizationId}::uuid
      and stall_id = ${input.stallId}::uuid
      and floor_id is null
  `);
  return floor.id;
}
