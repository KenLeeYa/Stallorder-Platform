import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import {
  BoundedMultipartError,
  readBoundedMultipartFormData,
} from "@/lib/bounded-multipart-form-data";
import { validateCsrf } from "@/lib/csrf";
import {
  getOrganizationProductNotes,
  getOrganizationReusableProductNotes,
} from "@/lib/product-note-data";
import {
  normalizedName,
  parseProductNoteTransfer,
  productNoteTransferMaxBytes,
  type ProductNoteTransfer,
} from "@/lib/product-note-transfer";
import {
  buildProductNoteImportPreview,
  type ResolvedProductNoteAssignment,
} from "@/lib/product-note-import-preview";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { invalidatePublicMenus } from "@/lib/public-menu";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

const maxImportBytes = productNoteTransferMaxBytes;
const maxMultipartBytes = maxImportBytes + 100_000;
type RouteContext = { params: Promise<{ organizationId: string }> };
type ImportMode = "PREVIEW" | "APPLY";

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_SHARED_PRODUCTS",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "CSRF_VALIDATION_FAILED",
      entityType: "PRODUCT_NOTES",
      outcome: "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  try {
    await entitlementService.assertFeatureEnabled(organizationId, "MODIFIERS");
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }

  let form: FormData | null = null;
  try {
    form = await readBoundedMultipartFormData(request, maxMultipartBytes);
  } catch (error) {
    if (error instanceof BoundedMultipartError) {
      const status = error.reason === "BODY_TOO_LARGE" || error.reason === "INVALID_CONTENT_LENGTH"
        ? 413
        : error.reason === "INVALID_CONTENT_TYPE"
          ? 415
          : error.reason === "READ_TIMEOUT"
            ? 408
            : 400;
      return NextResponse.json(
        { error: status === 413 ? "註記匯入檔不可超過 1MB。" : status === 408 ? "註記匯入逾時，請重試。" : "註記匯入格式不正確。" },
        { status, headers: { "x-request-id": authorization.requestId } },
      );
    }
  }
  const file = form?.get("productNotes") ?? null;
  const mode = form?.get("mode") ?? null;
  if (!isImportMode(mode)) {
    return NextResponse.json(
      { error: "請指定匯入預覽或套用模式。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (
    !(file instanceof File)
    || file.size === 0
    || file.size > maxImportBytes
    || !file.name.toLocaleLowerCase("en-US").endsWith(".json")
  ) {
    return NextResponse.json(
      { error: "請選擇 1MB 以下的 JSON 註記匯出檔。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const parsed = parseProductNoteTransfer(await file.text());
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { defaultCurrency: true },
  });
  if (!organization) {
    return NextResponse.json(
      { error: "找不到商家資料。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (parsed.transfer.sourceCurrency !== organization.defaultCurrency) {
    return NextResponse.json({
      error: `匯入檔幣別為 ${parsed.transfer.sourceCurrency}，目前商家幣別為 ${organization.defaultCurrency}；為避免價格調整金額誤用，無法匯入。`,
    }, {
      status: 400,
      headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
    });
  }

  const resolution = await resolveProductReferences(organizationId, parsed.transfer);
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.error }, {
      status: 400,
      headers: { "x-request-id": authorization.requestId },
    });
  }
  const summary = importSummary(parsed.transfer, resolution.assignmentsByGroup);
  if (mode === "PREVIEW") {
    const existing = await loadExistingImportSnapshot(organizationId, parsed.transfer);
    const preview = buildProductNoteImportPreview(
      parsed.transfer,
      resolution.assignmentsByGroup,
      existing,
    );
    return NextResponse.json({
      summary: { ...summary, ...preview.counts },
      previewReusableNotes: preview.reusableNotes,
      previewGroups: preview.groups,
    }, {
      headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
    });
  }

  try {
    await prisma.$transaction(async (transaction) => {
      const reusableNotes = await upsertReusableNotes(transaction, organizationId, parsed.transfer);
      await upsertGroups(
        transaction,
        organizationId,
        parsed.transfer,
        resolution.assignmentsByGroup,
        reusableNotes,
      );
    }, { timeout: 60_000 });
  } catch (error) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return NextResponse.json({
      error: duplicate
        ? "匯入檔內的註記名稱與現有資料衝突，沒有寫入任何資料。"
        : "註記匯入失敗，沒有寫入任何資料。",
    }, {
      status: duplicate ? 409 : 500,
      headers: { "x-request-id": authorization.requestId },
    });
  }

  const [auditResult, invalidationResult, refreshedDataResult] = await Promise.allSettled([
    recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "PRODUCT_NOTES_IMPORTED",
      entityType: "PRODUCT_NOTES",
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: summary,
    }),
    Promise.resolve().then(() => invalidatePublicMenus(
      authorization.workspace.stalls.map((stall) => stall.id),
    )),
    Promise.all([
      getOrganizationProductNotes(organizationId),
      getOrganizationReusableProductNotes(organizationId),
    ]),
  ]);
  if (
    auditResult.status === "rejected"
    || invalidationResult.status === "rejected"
    || refreshedDataResult.status === "rejected"
  ) {
    console.error(JSON.stringify({
      event: "product_notes_import_post_commit_refresh_failed",
      requestId: authorization.requestId,
      auditFailed: auditResult.status === "rejected",
      invalidationFailed: invalidationResult.status === "rejected",
      refreshFailed: refreshedDataResult.status === "rejected",
    }));
  }
  const refreshedData = refreshedDataResult.status === "fulfilled"
    ? refreshedDataResult.value
    : null;
  return NextResponse.json({
    summary,
    committed: true,
    ...(refreshedData ? { noteGroups: refreshedData[0], reusableNotes: refreshedData[1] } : {}),
    ...(invalidationResult.status === "rejected" || !refreshedData
      ? { warning: "註記已完成匯入；部分畫面資料更新延遲，請重新整理後確認。" }
      : {}),
  }, {
    headers: { "x-request-id": authorization.requestId },
  });
}

async function resolveProductReferences(
  organizationId: string,
  transfer: ProductNoteTransfer,
) {
  const products = await prisma.product.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const byName = new Map<string, typeof products>();
  for (const product of products) {
    const key = normalizedName(product.name);
    const matches = byName.get(key);
    if (matches) matches.push(product);
    else byName.set(key, [product]);
  }

  const assignmentsByGroup: ResolvedProductNoteAssignment[][] = [];
  for (const group of transfer.groups) {
    const assignments: ResolvedProductNoteAssignment[] = [];
    for (const reference of group.products) {
      const byExactId = reference.id ? byId.get(reference.id) : undefined;
      const namedMatches = byName.get(normalizedName(reference.name)) ?? [];
      const product = byExactId ?? (namedMatches.length === 1 ? namedMatches[0] : undefined);
      if (!product) {
        const reason = namedMatches.length > 1 ? "名稱重複，無法判斷" : "不存在";
        return { ok: false as const, error: `商品「${reference.name}」${reason}，請先確認共用商品主檔。` };
      }
      if (assignments.some((assignment) => assignment.productId === product.id)) {
        return { ok: false as const, error: `註記群組「${group.name}」重複指派商品「${product.name}」。` };
      }
      assignments.push({
        productId: product.id,
        productName: product.name,
        sortOrder: reference.sortOrder,
      });
    }
    assignmentsByGroup.push(assignments);
  }
  return { ok: true as const, assignmentsByGroup };
}

async function loadExistingImportSnapshot(
  organizationId: string,
  transfer: ProductNoteTransfer,
) {
  const [reusableNotes, groups] = await Promise.all([
    prisma.reusableProductNote.findMany({
      where: {
        organizationId,
        name: { in: transfer.reusableNotes.map((note) => note.name) },
      },
      select: {
        name: true,
        priceDelta: true,
        sortOrder: true,
        isActive: true,
        translations: { select: { locale: true, name: true } },
      },
    }),
    prisma.productNoteGroup.findMany({
      where: {
        organizationId,
        name: { in: transfer.groups.map((group) => group.name) },
      },
      select: {
        name: true,
        selectionMode: true,
        isRequired: true,
        minSelections: true,
        maxSelections: true,
        sortOrder: true,
        isActive: true,
        translations: { select: { locale: true, name: true } },
        assignments: {
          select: {
            productId: true,
            sortOrder: true,
            isActive: true,
            product: { select: { name: true } },
          },
        },
        options: {
          select: {
            name: true,
            priceDelta: true,
            sortOrder: true,
            isActive: true,
            reusableNote: { select: { name: true } },
            translations: { select: { locale: true, name: true } },
          },
        },
      },
    }),
  ]);
  return {
    reusableNotes,
    groups: groups.map((group) => ({
      ...group,
      assignments: group.assignments.map((assignment) => ({
        productId: assignment.productId,
        productName: assignment.product.name,
        sortOrder: assignment.sortOrder,
        isActive: assignment.isActive,
      })),
      options: group.options.map((option) => ({
        name: option.name,
        reusableNoteName: option.reusableNote?.name ?? null,
        priceDelta: option.priceDelta,
        sortOrder: option.sortOrder,
        isActive: option.isActive,
        translations: option.translations,
      })),
    })),
  };
}

async function upsertReusableNotes(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  transfer: ProductNoteTransfer,
) {
  const reusableNotes = new Map<string, {
    id: string;
    name: string;
    priceDelta: number;
    isActive: boolean;
  }>();
  for (const note of transfer.reusableNotes) {
    const record = await transaction.reusableProductNote.upsert({
      where: { organizationId_name: { organizationId, name: note.name } },
      create: {
        organizationId,
        name: note.name,
        priceDelta: note.priceDelta,
        sortOrder: note.sortOrder,
        isActive: note.isActive,
      },
      update: {
        priceDelta: note.priceDelta,
        sortOrder: note.sortOrder,
        isActive: note.isActive,
      },
      select: { id: true, name: true, priceDelta: true, isActive: true },
    });
    await syncReusableTranslations(transaction, organizationId, record.id, note.translations);
    reusableNotes.set(normalizedName(note.name), record);
  }
  return reusableNotes;
}

async function upsertGroups(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  transfer: ProductNoteTransfer,
  assignmentsByGroup: ResolvedProductNoteAssignment[][],
  reusableNotes: ReadonlyMap<string, { id: string; name: string; priceDelta: number; isActive: boolean }>,
) {
  for (const [groupIndex, group] of transfer.groups.entries()) {
    const record = await transaction.productNoteGroup.upsert({
      where: { organizationId_name: { organizationId, name: group.name } },
      create: {
        organizationId,
        name: group.name,
        selectionMode: group.selectionMode,
        isRequired: group.isRequired,
        minSelections: group.minSelections,
        maxSelections: group.selectionMode === "SINGLE" ? 1 : group.maxSelections,
        sortOrder: group.sortOrder,
        isActive: group.isActive,
      },
      update: {
        selectionMode: group.selectionMode,
        isRequired: group.isRequired,
        minSelections: group.minSelections,
        maxSelections: group.selectionMode === "SINGLE" ? 1 : group.maxSelections,
        sortOrder: group.sortOrder,
        isActive: group.isActive,
      },
      select: { id: true },
    });
    await syncGroupTranslations(transaction, organizationId, record.id, group.translations);

    const assignments = assignmentsByGroup[groupIndex] ?? [];
    for (const assignment of assignments) {
      await transaction.productNoteGroupAssignment.upsert({
        where: { productId_noteGroupId: { productId: assignment.productId, noteGroupId: record.id } },
        create: {
          organizationId,
          noteGroupId: record.id,
          productId: assignment.productId,
          sortOrder: assignment.sortOrder,
          isActive: true,
        },
        update: { sortOrder: assignment.sortOrder, isActive: true },
      });
    }

    for (const option of group.options) {
      const reusable = option.reusableNoteName
        ? reusableNotes.get(normalizedName(option.reusableNoteName))
        : undefined;
      if (option.reusableNoteName && !reusable) throw new Error("REUSABLE_NOTE_REFERENCE_INVALID");
      const optionName = reusable?.name ?? option.name;
      const optionRecord = await transaction.productNoteOption.upsert({
        where: { noteGroupId_name: { noteGroupId: record.id, name: optionName } },
        create: {
          organizationId,
          noteGroupId: record.id,
          reusableNoteId: reusable?.id ?? null,
          name: optionName,
          priceDelta: reusable?.priceDelta ?? option.priceDelta,
          sortOrder: option.sortOrder,
          isActive: reusable?.isActive ?? option.isActive,
        },
        update: {
          reusableNoteId: reusable?.id ?? null,
          priceDelta: reusable?.priceDelta ?? option.priceDelta,
          sortOrder: option.sortOrder,
          isActive: reusable?.isActive ?? option.isActive,
        },
        select: { id: true },
      });
      if (!reusable) {
        await syncOptionTranslations(transaction, organizationId, optionRecord.id, option.translations);
      }
    }
  }
}

async function syncReusableTranslations(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  reusableNoteId: string,
  translations: ProductNoteTransfer["reusableNotes"][number]["translations"],
) {
  for (const translation of translations) {
    await transaction.reusableProductNoteTranslation.upsert({
      where: { reusableNoteId_locale: { reusableNoteId, locale: translation.locale } },
      create: { organizationId, reusableNoteId, ...translation },
      update: { name: translation.name },
    });
  }
}

async function syncGroupTranslations(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  noteGroupId: string,
  translations: ProductNoteTransfer["groups"][number]["translations"],
) {
  for (const translation of translations) {
    await transaction.productNoteGroupTranslation.upsert({
      where: { noteGroupId_locale: { noteGroupId, locale: translation.locale } },
      create: { organizationId, noteGroupId, ...translation },
      update: { name: translation.name },
    });
  }
}

async function syncOptionTranslations(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  noteOptionId: string,
  translations: ProductNoteTransfer["groups"][number]["options"][number]["translations"],
) {
  for (const translation of translations) {
    await transaction.productNoteOptionTranslation.upsert({
      where: { noteOptionId_locale: { noteOptionId, locale: translation.locale } },
      create: { organizationId, noteOptionId, ...translation },
      update: { name: translation.name },
    });
  }
}

function isImportMode(value: FormDataEntryValue | null): value is ImportMode {
  return value === "PREVIEW" || value === "APPLY";
}

function importSummary(transfer: ProductNoteTransfer, assignmentsByGroup: ResolvedProductNoteAssignment[][]) {
  return {
    reusableNoteCount: transfer.reusableNotes.length,
    groupCount: transfer.groups.length,
    optionCount: transfer.groups.reduce((total, group) => total + group.options.length, 0),
    assignmentCount: assignmentsByGroup.reduce((total, assignments) => total + assignments.length, 0),
  };
}
