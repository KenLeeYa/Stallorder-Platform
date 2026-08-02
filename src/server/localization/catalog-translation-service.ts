import "server-only";

import { Prisma } from "@prisma/client";
import type { TranslationLocale } from "@/lib/enabled-locales";
import { prisma } from "@/lib/prisma";
import {
  buildCatalogTranslationRequests,
  chunkCatalogTranslationRequest,
  validateCatalogTranslationOutput,
  type CatalogTranslationProvider,
  type CatalogTranslationSource,
  type ValidatedCatalogTranslation,
} from "@/server/localization/catalog-translation-contract";

const TRANSLATION_BATCH_SIZE = 50;
const TRANSLATION_CONCURRENCY = 3;
const MAX_TRANSLATION_TARGETS = 1_000;
const DATABASE_WRITE_BATCH_SIZE = 20;

export class CatalogTranslationLimitError extends Error {
  readonly code = "AI_TRANSLATION_LIMIT_EXCEEDED";
}

export class CatalogTranslationSourceChangedError extends Error {
  readonly code = "AI_TRANSLATION_SOURCE_CHANGED";
}

export async function translateMissingCatalogContent({
  organizationId,
  locales,
  provider,
}: {
  organizationId: string;
  locales: readonly TranslationLocale[];
  provider: CatalogTranslationProvider;
}) {
  const source = await loadTranslationSource(organizationId);
  const requests = buildCatalogTranslationRequests(source, locales);
  const targetCount = requests.reduce((total, request) => total + request.items.length, 0);
  if (targetCount === 0) return emptySummary(locales);
  if (targetCount > MAX_TRANSLATION_TARGETS) {
    throw new CatalogTranslationLimitError(
      `本次共有 ${targetCount} 個翻譯目標，超過單次上限 ${MAX_TRANSLATION_TARGETS}。`,
    );
  }

  const batches = requests.flatMap((request) => (
    chunkCatalogTranslationRequest(request, TRANSLATION_BATCH_SIZE)
  ));
  const outputs = await mapWithConcurrency(
    batches,
    TRANSLATION_CONCURRENCY,
    async (batch) => validateCatalogTranslationOutput(batch, await provider.translate(batch)),
  );
  const translations = outputs.flat();
  const persisted = await persistTranslations(organizationId, translations);

  return {
    targetLocales: locales,
    requestedTargets: targetCount,
    translatedFields: persisted.translatedFields,
    translatedProducts: persisted.translatedProducts,
    translatedNoteGroups: persisted.translatedNoteGroups,
    translatedNoteOptions: persisted.translatedNoteOptions,
    translatedReusableNotes: persisted.translatedReusableNotes,
  };
}

async function loadTranslationSource(organizationId: string): Promise<CatalogTranslationSource> {
  const [products, noteGroups, reusableNotes] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        category: { select: { name: true } },
        group: { select: { name: true } },
        translations: {
          select: { locale: true, name: true, description: true },
        },
      },
    }),
    prisma.productNoteGroup.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        translations: { select: { locale: true, name: true } },
        options: {
          where: { isActive: true, reusableNoteId: null },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            translations: { select: { locale: true, name: true } },
          },
        },
      },
    }),
    prisma.reusableProductNote.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        translations: { select: { locale: true, name: true } },
      },
    }),
  ]);

  return {
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      categoryName: product.category.name,
      groupName: product.group?.name ?? null,
      translations: product.translations,
    })),
    noteGroups,
    reusableNotes,
  };
}

async function persistTranslations(
  organizationId: string,
  translations: ValidatedCatalogTranslation[],
) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const locales = [...new Set(translations.map((translation) => translation.locale))];
      const productIds = uniqueEntityIds(translations, "PRODUCT");
      const noteGroupIds = uniqueEntityIds(translations, "NOTE_GROUP");
      const noteOptionIds = uniqueEntityIds(translations, "NOTE_OPTION");
      const reusableNoteIds = uniqueEntityIds(translations, "REUSABLE_NOTE");
      const [products, noteGroups, noteOptions, reusableNotes] = await Promise.all([
        transaction.product.findMany({
          where: { organizationId, id: { in: productIds }, isActive: true },
          select: {
            id: true,
            name: true,
            description: true,
            translations: {
              where: { locale: { in: locales } },
              select: { locale: true, name: true, description: true },
            },
          },
        }),
        transaction.productNoteGroup.findMany({
          where: { organizationId, id: { in: noteGroupIds }, isActive: true },
          select: {
            id: true,
            name: true,
            translations: {
              where: { locale: { in: locales } },
              select: { locale: true, name: true },
            },
          },
        }),
        transaction.productNoteOption.findMany({
          where: {
            organizationId,
            id: { in: noteOptionIds },
            isActive: true,
            noteGroup: { isActive: true },
          },
          select: {
            id: true,
            name: true,
            translations: {
              where: { locale: { in: locales } },
              select: { locale: true, name: true },
            },
          },
        }),
        transaction.reusableProductNote.findMany({
          where: { organizationId, id: { in: reusableNoteIds }, isActive: true },
          select: {
            id: true,
            name: true,
            translations: {
              where: { locale: { in: locales } },
              select: { locale: true, name: true },
            },
          },
        }),
      ]);

      if (
        products.length !== productIds.length
        || noteGroups.length !== noteGroupIds.length
        || noteOptions.length !== noteOptionIds.length
        || reusableNotes.length !== reusableNoteIds.length
      ) {
        throw new CatalogTranslationSourceChangedError("翻譯期間商品資料已變更。");
      }

      const productsById = new Map(products.map((product) => [product.id, product]));
      const noteGroupsById = new Map(noteGroups.map((group) => [group.id, group]));
      const noteOptionsById = new Map(noteOptions.map((option) => [option.id, option]));
      const reusableNotesById = new Map(reusableNotes.map((note) => [note.id, note]));
      for (const translation of translations) {
        if (translation.entityType === "PRODUCT") {
          const product = productsById.get(translation.entityId);
          if (
            product?.name !== translation.sourceName
            || product.description !== (translation.sourceDescription ?? "")
          ) {
            throw new CatalogTranslationSourceChangedError("翻譯期間商品原文已變更。");
          }
        } else if (translation.entityType === "NOTE_GROUP") {
          if (noteGroupsById.get(translation.entityId)?.name !== translation.sourceName) {
            throw new CatalogTranslationSourceChangedError("翻譯期間註記群組原文已變更。");
          }
        } else if (translation.entityType === "REUSABLE_NOTE") {
          if (reusableNotesById.get(translation.entityId)?.name !== translation.sourceName) {
            throw new CatalogTranslationSourceChangedError("翻譯期間共用註記原文已變更。");
          }
        } else if (noteOptionsById.get(translation.entityId)?.name !== translation.sourceName) {
          throw new CatalogTranslationSourceChangedError("翻譯期間註記選項原文已變更。");
        }
      }

      const currentProducts = translationMap(products);
      const currentNoteGroups = translationMap(noteGroups);
      const currentNoteOptions = translationMap(noteOptions);
      const currentReusableNotes = translationMap(reusableNotes);
      const results: Array<{
        entityType: ValidatedCatalogTranslation["entityType"];
        entityId: string;
        translatedFields: number;
      }> = [];

      for (let index = 0; index < translations.length; index += DATABASE_WRITE_BATCH_SIZE) {
        const batch = translations.slice(index, index + DATABASE_WRITE_BATCH_SIZE);
        results.push(...await Promise.all(batch.map(async (translation) => {
          if (translation.entityType === "PRODUCT") {
            const existing = currentProducts.get(mapKey(translation.entityId, translation.locale));
            const name = existing?.name.trim() || translation.name;
            if (!name) throw new CatalogTranslationSourceChangedError("商品翻譯名稱已失效。");
            const existingDescription = existing && "description" in existing
              ? existing.description ?? ""
              : "";
            const hasExistingDescription = Boolean(existingDescription.trim());
            const description = hasExistingDescription ? existingDescription : translation.description ?? "";
            const translatedFields = Number(!existing?.name.trim() && Boolean(translation.name))
              + Number(
                !hasExistingDescription && Boolean(translation.description),
              );
            await transaction.productTranslation.upsert({
              where: {
                productId_locale: {
                  productId: translation.entityId,
                  locale: translation.locale,
                },
              },
              create: {
                organizationId,
                productId: translation.entityId,
                locale: translation.locale,
                name,
                description,
              },
              update: { name, description },
            });
            return { entityType: translation.entityType, entityId: translation.entityId, translatedFields };
          }

          const currentMap = translation.entityType === "NOTE_GROUP"
            ? currentNoteGroups
            : translation.entityType === "REUSABLE_NOTE"
              ? currentReusableNotes
              : currentNoteOptions;
          const existing = currentMap.get(mapKey(translation.entityId, translation.locale));
          const name = existing?.name.trim() || translation.name;
          if (!name) throw new CatalogTranslationSourceChangedError("註記翻譯名稱已失效。");
          const translatedFields = Number(!existing?.name.trim() && Boolean(translation.name));
          if (translation.entityType === "NOTE_GROUP") {
            await transaction.productNoteGroupTranslation.upsert({
              where: {
                noteGroupId_locale: {
                  noteGroupId: translation.entityId,
                  locale: translation.locale,
                },
              },
              create: {
                organizationId,
                noteGroupId: translation.entityId,
                locale: translation.locale,
                name,
              },
              update: { name },
            });
          } else if (translation.entityType === "REUSABLE_NOTE") {
            await transaction.reusableProductNoteTranslation.upsert({
              where: {
                reusableNoteId_locale: {
                  reusableNoteId: translation.entityId,
                  locale: translation.locale,
                },
              },
              create: {
                organizationId,
                reusableNoteId: translation.entityId,
                locale: translation.locale,
                name,
              },
              update: { name },
            });
          } else {
            await transaction.productNoteOptionTranslation.upsert({
              where: {
                noteOptionId_locale: {
                  noteOptionId: translation.entityId,
                  locale: translation.locale,
                },
              },
              create: {
                organizationId,
                noteOptionId: translation.entityId,
                locale: translation.locale,
                name,
              },
              update: { name },
            });
          }
          return { entityType: translation.entityType, entityId: translation.entityId, translatedFields };
        })));
      }

      return summarizeWrites(results);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30_000,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new CatalogTranslationSourceChangedError("翻譯寫入時發生併發更新。");
    }
    throw error;
  }
}

function uniqueEntityIds(
  translations: ValidatedCatalogTranslation[],
  entityType: ValidatedCatalogTranslation["entityType"],
) {
  return [...new Set(
    translations
      .filter((translation) => translation.entityType === entityType)
      .map((translation) => translation.entityId),
  )];
}

function translationMap<T extends { id: string; translations: Array<{ locale: string; name: string; description?: string }> }>(
  entities: T[],
) {
  return new Map(entities.flatMap((entity) => (
    entity.translations.map((translation) => [mapKey(entity.id, translation.locale), translation] as const)
  )));
}

function mapKey(entityId: string, locale: string) {
  return `${entityId}:${locale}`;
}

function summarizeWrites(
  writes: Array<{
    entityType: ValidatedCatalogTranslation["entityType"];
    entityId: string;
    translatedFields: number;
  }>,
) {
  const changed = writes.filter((write) => write.translatedFields > 0);
  return {
    translatedFields: changed.reduce((total, write) => total + write.translatedFields, 0),
    translatedProducts: new Set(
      changed.filter((write) => write.entityType === "PRODUCT").map((write) => write.entityId),
    ).size,
    translatedNoteGroups: new Set(
      changed.filter((write) => write.entityType === "NOTE_GROUP").map((write) => write.entityId),
    ).size,
    translatedNoteOptions: new Set(
      changed.filter((write) => write.entityType === "NOTE_OPTION").map((write) => write.entityId),
    ).size,
    translatedReusableNotes: new Set(
      changed.filter((write) => write.entityType === "REUSABLE_NOTE").map((write) => write.entityId),
    ).size,
  };
}

function emptySummary(locales: readonly TranslationLocale[]) {
  return {
    targetLocales: locales,
    requestedTargets: 0,
    translatedFields: 0,
    translatedProducts: 0,
    translatedNoteGroups: 0,
    translatedNoteOptions: 0,
    translatedReusableNotes: 0,
  };
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
) {
  const outputs = new Array<Output>(inputs.length);
  let cursor = 0;
  async function worker() {
    while (cursor < inputs.length) {
      const index = cursor++;
      outputs[index] = await operation(inputs[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()),
  );
  return outputs;
}
