import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { productNoteTransferFileName, serializeProductNoteTransfer } from "@/lib/product-note-transfer";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_SHARED_PRODUCTS",
  );
  if (!authorization.ok) return authorization.response;
  try {
    await entitlementService.assertFeatureEnabled(organizationId, "MODIFIERS");
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }

  const [organization, reusableNotes, groups] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { defaultCurrency: true },
    }),
    prisma.reusableProductNote.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        priceDelta: true,
        sortOrder: true,
        isActive: true,
        translations: {
          orderBy: { locale: "asc" },
          select: { locale: true, name: true },
        },
      },
    }),
    prisma.productNoteGroup.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        name: true,
        selectionMode: true,
        isRequired: true,
        minSelections: true,
        maxSelections: true,
        sortOrder: true,
        isActive: true,
        translations: {
          orderBy: { locale: "asc" },
          select: { locale: true, name: true },
        },
        assignments: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { productId: "asc" }],
          select: { sortOrder: true, product: { select: { id: true, name: true } } },
        },
        options: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            name: true,
            reusableNoteId: true,
            priceDelta: true,
            sortOrder: true,
            isActive: true,
            translations: {
              orderBy: { locale: "asc" },
              select: { locale: true, name: true },
            },
          },
        },
      },
    }),
  ]);
  if (!organization) {
    return NextResponse.json(
      { error: "找不到商家資料。" },
      { status: 404, headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  }
  const reusableNames = new Map(reusableNotes.map((note) => [note.id, note.name]));
  const serialized = serializeProductNoteTransfer({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sourceCurrency: organization.defaultCurrency,
    reusableNotes: reusableNotes.map((note) => ({
      name: note.name,
      priceDelta: note.priceDelta,
      sortOrder: note.sortOrder,
      isActive: note.isActive,
      translations: note.translations,
    })),
    groups: groups.map((group) => ({
      name: group.name,
      selectionMode: group.selectionMode,
      isRequired: group.isRequired,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      sortOrder: group.sortOrder,
      isActive: group.isActive,
      translations: group.translations,
      products: group.assignments.map((assignment) => ({
        ...assignment.product,
        sortOrder: assignment.sortOrder,
      })),
      options: group.options.map((option) => ({
        name: option.name,
        reusableNoteName: option.reusableNoteId
          ? reusableNames.get(option.reusableNoteId) ?? null
          : null,
        priceDelta: option.priceDelta,
        sortOrder: option.sortOrder,
        isActive: option.isActive,
        translations: option.translations,
      })),
    })),
  });
  if (!serialized.ok) {
    return NextResponse.json(
      { error: serialized.error },
      { status: 422, headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  }

  return new NextResponse(serialized.text, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${productNoteTransferFileName()}"`,
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-request-id": authorization.requestId,
    },
  });
}
