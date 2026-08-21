import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  catalogTranslationBenchmarkCases,
  catalogTranslationBenchmarkLocales,
  type CatalogTranslationBenchmarkRisk,
} from "./fixtures/catalog-translation-benchmark";
import {
  validateCatalogTranslationOutput,
  type CatalogTranslationOutput,
  type CatalogTranslationRequest,
} from "../src/server/localization/catalog-translation-contract";
import {
  createCatalogTranslationProvider,
  getCatalogTranslationProviderLabel,
  isCatalogTranslationConfigured,
  resolveCatalogTranslationRequestCredential,
} from "../src/server/localization/catalog-translation-provider";

const targetCount = catalogTranslationBenchmarkCases.length * catalogTranslationBenchmarkLocales.length;

type BenchmarkResult = {
  caseId: string;
  locale: (typeof catalogTranslationBenchmarkLocales)[number];
  risks: readonly CatalogTranslationBenchmarkRisk[];
  sourceName: string;
  sourceDescription: string;
  translatedName: string | null;
  translatedDescription: string | null;
  hardGuards: "PASS";
  humanReview: {
    accuracy: null;
    naturalness: null;
    menuTerminology: null;
    notes: string;
  };
};

async function main() {
  if (process.argv.includes("--dry-run")) {
    process.stdout.write(`${JSON.stringify({
      caseCount: catalogTranslationBenchmarkCases.length,
      locales: catalogTranslationBenchmarkLocales,
      targetCount,
      upstreamRequests: catalogTranslationBenchmarkLocales.length,
    }, null, 2)}\n`);
    return;
  }

  const requestCredential = await resolveCatalogTranslationRequestCredential();
  if (!isCatalogTranslationConfigured(requestCredential)) {
    throw new Error("翻譯 provider 尚未完成設定；未送出 benchmark，也未產生結果檔。");
  }
  const providerLabel = getCatalogTranslationProviderLabel(requestCredential);
  const provider = createCatalogTranslationProvider(requestCredential);
  const startedAt = new Date();
  const results: BenchmarkResult[] = [];

  for (const locale of catalogTranslationBenchmarkLocales) {
    const request: CatalogTranslationRequest = {
      locale,
      items: catalogTranslationBenchmarkCases.map((item, index) => ({
        key: `item-${index}`,
        entityType: "PRODUCT",
        entityId: item.id,
        sourceName: item.sourceName,
        sourceDescription: item.sourceDescription,
        context: item.context,
        existingName: null,
        needsName: true,
        needsDescription: true,
      })),
    };
    const output = await provider.translate(request);
    let validated;
    try {
      validated = validateCatalogTranslationOutput(request, output);
    } catch (error) {
      throw diagnoseCatalogTranslationFailure(request, output, error);
    }
    validated.forEach((translation, index) => {
      const source = catalogTranslationBenchmarkCases[index];
      results.push({
        caseId: source.id,
        locale,
        risks: source.risks,
        sourceName: source.sourceName,
        sourceDescription: source.sourceDescription,
        translatedName: translation.name,
        translatedDescription: translation.description,
        hardGuards: "PASS",
        humanReview: {
          accuracy: null,
          naturalness: null,
          menuTerminology: null,
          notes: "",
        },
      });
    });
  }

  const outputPath = resolveOutputPath(process.argv);
  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    provider: providerLabel,
    sourceRevision: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null,
    caseCount: catalogTranslationBenchmarkCases.length,
    locales: catalogTranslationBenchmarkLocales,
    targetCount,
    hardGuardFailures: 0,
    reviewStatus: "PENDING_NATIVE_REVIEW",
    results,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    outputPath,
    provider: providerLabel,
    targetCount,
    hardGuardFailures: 0,
    reviewStatus: report.reviewStatus,
  }, null, 2)}\n`);
}

function diagnoseCatalogTranslationFailure(
  request: CatalogTranslationRequest,
  output: CatalogTranslationOutput,
  originalError: unknown,
) {
  for (const item of request.items) {
    try {
      validateCatalogTranslationOutput(
        { locale: request.locale, items: [item] },
        { items: output.items.filter((translated) => translated.key === item.key) },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知錯誤";
      return new Error(`[${request.locale}/${item.entityId}] ${message}`, { cause: originalError });
    }
  }
  return originalError instanceof Error ? originalError : new Error("翻譯結果未通過 hard guard。");
}

function resolveOutputPath(argv: readonly string[]) {
  const outputIndex = argv.indexOf("--output");
  if (outputIndex === -1) {
    return resolve("artifacts", "catalog-translation-benchmark-latest.json");
  }
  const value = argv[outputIndex + 1]?.trim();
  if (!value) throw new Error("--output 後必須提供結果檔路徑。");
  return resolve(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "未知錯誤";
  process.stderr.write(`Catalog translation benchmark failed: ${message}\n`);
  process.exitCode = 1;
});
