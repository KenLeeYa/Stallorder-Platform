import "server-only";

import { Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { defaultMerchantBusinessTypeOptions, type MerchantBusinessTypeOptionCommand } from "@/lib/merchant-business-type-options";
import { prisma } from "@/lib/prisma";

type PlatformAuditContext = {
  actorProfileId: string;
  requestId: string;
  ipHash: string;
};

export async function listActiveMerchantBusinessTypeOptions() {
  await ensureDefaultMerchantBusinessTypeOptions();
  const options = await prisma.merchantBusinessTypeOption.findMany({
    where: { isActive: true, archivedAt: null, legacyType: { not: null } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, legacyType: true, name: true, description: true, sortOrder: true, isActive: true },
  });
  return options.map((option) => ({
    ...option,
    legacyType: option.legacyType ?? "OTHER",
  }));
}

export async function listMerchantBusinessTypeOptionsForAdmin() {
  await ensureDefaultMerchantBusinessTypeOptions();
  return prisma.merchantBusinessTypeOption.findMany({
    orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      legacyType: true,
      name: true,
      description: true,
      sortOrder: true,
      isActive: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function upsertMerchantBusinessTypeOption(command: MerchantBusinessTypeOptionCommand, context: PlatformAuditContext) {
  const result = await prisma.$transaction(async (transaction) => {
    const before = await transaction.merchantBusinessTypeOption.findUnique({
      where: { code: command.code },
      select: { id: true, code: true, legacyType: true, name: true, description: true, sortOrder: true, isActive: true, archivedAt: true },
    });
    const saved = await transaction.merchantBusinessTypeOption.upsert({
      where: { code: command.code },
      create: {
        code: command.code,
        legacyType: command.legacyType,
        name: command.name,
        description: command.description ?? null,
        sortOrder: command.sortOrder,
        isActive: command.isActive,
        createdById: context.actorProfileId,
        updatedById: context.actorProfileId,
      },
      update: {
        legacyType: command.legacyType,
        name: command.name,
        description: command.description ?? null,
        sortOrder: command.sortOrder,
        isActive: command.isActive,
        archivedAt: null,
        updatedById: context.actorProfileId,
      },
      select: { id: true, code: true, legacyType: true, name: true, description: true, sortOrder: true, isActive: true, archivedAt: true },
    });
    return { before, saved };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await recordAuditEvent({
    actorProfileId: context.actorProfileId,
    requestId: context.requestId,
    ipHash: context.ipHash,
    action: result.before ? "MERCHANT_BUSINESS_TYPE_UPDATED" : "MERCHANT_BUSINESS_TYPE_CREATED",
    entityType: "MERCHANT_BUSINESS_TYPE_OPTION",
    entityId: result.saved.id,
    outcome: "SUCCESS",
    before: result.before ? auditSnapshot(result.before) : undefined,
    after: auditSnapshot(result.saved),
  });
  return result.saved;
}

export async function archiveMerchantBusinessTypeOption(optionId: string, context: PlatformAuditContext) {
  const result = await prisma.$transaction(async (transaction) => {
    const before = await transaction.merchantBusinessTypeOption.findUnique({
      where: { id: optionId },
      select: { id: true, code: true, legacyType: true, name: true, description: true, sortOrder: true, isActive: true, archivedAt: true },
    });
    if (!before) return null;
    const saved = await transaction.merchantBusinessTypeOption.update({
      where: { id: optionId },
      data: { isActive: false, archivedAt: new Date(), updatedById: context.actorProfileId },
      select: { id: true, code: true, legacyType: true, name: true, description: true, sortOrder: true, isActive: true, archivedAt: true },
    });
    return { before, saved };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result) return null;

  await recordAuditEvent({
    actorProfileId: context.actorProfileId,
    requestId: context.requestId,
    ipHash: context.ipHash,
    action: "MERCHANT_BUSINESS_TYPE_ARCHIVED",
    entityType: "MERCHANT_BUSINESS_TYPE_OPTION",
    entityId: result.saved.id,
    outcome: "SUCCESS",
    before: auditSnapshot(result.before),
    after: auditSnapshot(result.saved),
  });
  return result.saved;
}

function auditSnapshot(option: {
  code: string;
  legacyType: string | null;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  archivedAt: Date | null;
}) {
  return {
    code: option.code,
    legacyType: option.legacyType,
    name: option.name,
    description: option.description,
    sortOrder: option.sortOrder,
    isActive: option.isActive,
    archivedAt: option.archivedAt?.toISOString() ?? null,
  };
}

export async function ensureDefaultMerchantBusinessTypeOptions() {
  const count = await prisma.merchantBusinessTypeOption.count();
  if (count > 0) return;
  await prisma.merchantBusinessTypeOption.createMany({
    data: defaultMerchantBusinessTypeOptions.map((option) => ({
      code: option.code,
      legacyType: option.legacyType,
      name: option.name,
      sortOrder: option.sortOrder,
    })),
    skipDuplicates: true,
  });
}
