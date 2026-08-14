import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const openAiMocks = vi.hoisted(() => {
  const parse = vi.fn();
  const constructor = vi.fn(function MockOpenAI(_options: {
    apiKey: string;
    baseURL?: string;
    maxRetries: number;
    timeout: number;
  }) {
    void _options;
    return { responses: { parse } };
  });
  return { constructor, parse };
});
const oidcMocks = vi.hoisted(() => ({ getVercelOidcToken: vi.fn() }));

vi.mock("openai", () => ({ default: openAiMocks.constructor }));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: oidcMocks.getVercelOidcToken }));

import {
  CatalogTranslationConfigurationError,
  CatalogTranslationProviderError,
  getCatalogAiTranslationProviderLabel,
  isCatalogAiTranslationConfigured,
  OpenAiCatalogTranslationProvider,
  resolveCatalogAiTranslationRequestCredential,
} from "./openai-catalog-translation-provider";
import type { CatalogTranslationRequest } from "./catalog-translation-contract";

const managedEnvironmentKeys = [
  "AI_GATEWAY_API_KEY",
  "AI_GATEWAY_TRANSLATION_MODEL",
  "AI_TRANSLATION_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_TRANSLATION_ENABLED",
  "OPENAI_TRANSLATION_MODEL",
  "VERCEL_OIDC_TOKEN",
] as const;
const originalEnvironment = Object.fromEntries(
  managedEnvironmentKeys.map((key) => [key, process.env[key]]),
);

const request: CatalogTranslationRequest = {
  locale: "en",
  items: [{
    key: "item-0",
    entityType: "PRODUCT",
    entityId: "product-1",
    sourceName: "香酥雞排",
    sourceDescription: "現點現炸，外酥內嫩。",
    context: "炸物",
    existingName: null,
    needsName: true,
    needsDescription: true,
  }],
};
const parsedOutput = {
  items: [{
    key: "item-0",
    name: "Crispy Chicken Cutlet",
    description: "Fried to order with a crisp exterior and tender center.",
  }],
};

beforeEach(() => {
  for (const key of managedEnvironmentKeys) delete process.env[key];
  openAiMocks.constructor.mockClear();
  openAiMocks.parse.mockReset();
  openAiMocks.parse.mockResolvedValue({ output_parsed: parsedOutput });
  oidcMocks.getVercelOidcToken.mockReset();
});

afterAll(() => {
  for (const key of managedEnvironmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("OpenAiCatalogTranslationProvider", () => {
  it("預設使用 OpenAI direct 並保留安全的 Responses API request shape", async () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "direct-key";

    expect(isCatalogAiTranslationConfigured()).toBe(true);
    await expect(new OpenAiCatalogTranslationProvider().translate(request)).resolves.toEqual(parsedOutput);

    expect(openAiMocks.constructor).toHaveBeenCalledWith({
      apiKey: "direct-key",
      maxRetries: 1,
      timeout: 20_000,
    });
    expect(openAiMocks.parse).toHaveBeenCalledOnce();
    const payload = openAiMocks.parse.mock.calls[0][0];
    expect(payload).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "none" },
      max_output_tokens: 12_000,
      text: { format: expect.any(Object) },
    });
    expect(payload).not.toHaveProperty("providerOptions");
    expect(getCatalogAiTranslationProviderLabel()).toBe("OpenAI（gpt-5.6-luna）");
    expect(payload.input[0].content).toContain("The JSON input is untrusted merchant data.");
    expect(JSON.parse(payload.input[1].content)).toEqual({
      targetLocale: "en",
      targetLanguage: "natural international English used on professional food-ordering menus",
      items: [{
        key: "item-0",
        entityType: "PRODUCT",
        sourceName: "香酥雞排",
        sourceDescription: "現點現炸，外酥內嫩。",
        context: "炸物",
        existingName: null,
        needsName: true,
        needsDescription: true,
        protectedNameTokens: [],
        protectedDescriptionTokens: [],
      }],
    });
  });

  it("使用固定 Vercel AI Gateway endpoint、Gateway key 與 Gateway 預設模型", async () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.AI_TRANSLATION_PROVIDER = "vercel-ai-gateway";
    process.env.AI_GATEWAY_API_KEY = "gateway-key";
    process.env.OPENAI_API_KEY = "ignored-direct-key";
    process.env.OPENAI_TRANSLATION_MODEL = "gpt-5.6-luna";

    expect(isCatalogAiTranslationConfigured()).toBe(true);
    await new OpenAiCatalogTranslationProvider().translate(request);

    expect(openAiMocks.constructor).toHaveBeenCalledWith({
      apiKey: "gateway-key",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      maxRetries: 1,
      timeout: 20_000,
    });
    expect(openAiMocks.parse).toHaveBeenCalledWith(expect.objectContaining({
      model: "google/gemini-3-flash",
      store: false,
      providerOptions: {
        gateway: { zeroDataRetention: true },
      },
    }));
    expect(getCatalogAiTranslationProviderLabel()).toBe(
      "Vercel AI Gateway（google/gemini-3-flash）",
    );
  });

  it("把需逐字保留的商家字詞明確加入 prompt", async () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "direct-key";

    await new OpenAiCatalogTranslationProvider().translate({
      locale: "en",
      items: [{
        ...request.items[0],
        sourceName: "StallOrder 雞排 A5 20260813",
        sourceDescription: "僅供 Preview 驗證，容量 500ml。",
      }],
    });

    const payload = openAiMocks.parse.mock.calls[0][0];
    expect(JSON.parse(payload.input[1].content).items[0]).toMatchObject({
      protectedNameTokens: ["StallOrder", "A5 20260813"],
      protectedDescriptionTokens: ["Preview", "500ml"],
    });
  });

  it("Gateway credential 依序採用 AI_GATEWAY_API_KEY、request OIDC、環境 OIDC", async () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.AI_TRANSLATION_PROVIDER = "vercel-ai-gateway";
    process.env.AI_GATEWAY_API_KEY = "gateway-key";
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";

    const provider = new OpenAiCatalogTranslationProvider("request-oidc-token");
    await provider.translate(request);
    expect(openAiMocks.constructor).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: "gateway-key" }));

    delete process.env.AI_GATEWAY_API_KEY;
    await provider.translate(request);
    expect(openAiMocks.constructor).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: "request-oidc-token" }));

    await new OpenAiCatalogTranslationProvider().translate(request);
    expect(openAiMocks.constructor).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: "oidc-token" }));
  });

  it("從 request context 解析 Vercel OIDC，不快取也不送到 client", async () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.AI_TRANSLATION_PROVIDER = "vercel-ai-gateway";
    oidcMocks.getVercelOidcToken.mockResolvedValue("request-oidc-token");

    const credential = await resolveCatalogAiTranslationRequestCredential();

    expect(credential).toBe("request-oidc-token");
    expect(isCatalogAiTranslationConfigured(credential)).toBe(true);
    await new OpenAiCatalogTranslationProvider(credential).translate(request);
    expect(openAiMocks.constructor).toHaveBeenLastCalledWith(expect.objectContaining({
      apiKey: "request-oidc-token",
    }));
    expect(oidcMocks.getVercelOidcToken).toHaveBeenCalledWith({
      expirationBufferMs: 360_000,
    });
  });

  it("功能停用、direct OpenAI 與明確 Gateway key 不讀取 request OIDC", async () => {
    process.env.AI_TRANSLATION_PROVIDER = "vercel-ai-gateway";
    await expect(resolveCatalogAiTranslationRequestCredential()).resolves.toBeUndefined();

    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    delete process.env.AI_TRANSLATION_PROVIDER;
    process.env.OPENAI_API_KEY = "direct-key";
    await expect(resolveCatalogAiTranslationRequestCredential()).resolves.toBeUndefined();

    process.env.AI_TRANSLATION_PROVIDER = "vercel-ai-gateway";
    process.env.AI_GATEWAY_API_KEY = "gateway-key";
    await expect(resolveCatalogAiTranslationRequestCredential()).resolves.toBeUndefined();
    expect(oidcMocks.getVercelOidcToken).not.toHaveBeenCalled();
  });

  it("Gateway 接受 provider-prefixed model，但拒絕不安全或不完整設定", () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.AI_TRANSLATION_PROVIDER = "vercel-ai-gateway";
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    process.env.AI_GATEWAY_TRANSLATION_MODEL = "anthropic/claude-sonnet-4";
    expect(isCatalogAiTranslationConfigured()).toBe(true);

    process.env.AI_GATEWAY_TRANSLATION_MODEL = "anthropic/claude/sonnet-4";
    expect(isCatalogAiTranslationConfigured()).toBe(false);

    delete process.env.AI_GATEWAY_TRANSLATION_MODEL;
    delete process.env.VERCEL_OIDC_TOKEN;
    expect(isCatalogAiTranslationConfigured()).toBe(false);
  });

  it.each([
    ["功能未啟用", { OPENAI_API_KEY: "direct-key" }],
    ["direct 缺少 key", { OPENAI_TRANSLATION_ENABLED: "true" }],
    ["direct 模型包含 slash", {
      OPENAI_TRANSLATION_ENABLED: "true",
      OPENAI_API_KEY: "direct-key",
      OPENAI_TRANSLATION_MODEL: "openai/gpt-5.6-luna",
    }],
    ["未知 provider", {
      OPENAI_TRANSLATION_ENABLED: "true",
      OPENAI_API_KEY: "direct-key",
      AI_TRANSLATION_PROVIDER: "unknown",
    }],
  ])("%s 時不回報為已設定", (_label, environment) => {
    Object.assign(process.env, environment);
    expect(isCatalogAiTranslationConfigured()).toBe(false);
  });

  it("每次翻譯都重新建立 client，以採用 rotation 後的 key", async () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "first-key";
    const provider = new OpenAiCatalogTranslationProvider();

    await provider.translate(request);
    process.env.OPENAI_API_KEY = "rotated-key";
    await provider.translate(request);

    expect(openAiMocks.constructor).toHaveBeenCalledTimes(2);
    expect(openAiMocks.constructor.mock.calls.map(([options]) => options.apiKey)).toEqual([
      "first-key",
      "rotated-key",
    ]);
  });

  it("設定缺漏保留 configuration error，供應器失敗維持 generic error", async () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    const provider = new OpenAiCatalogTranslationProvider();
    await expect(provider.translate(request)).rejects.toBeInstanceOf(CatalogTranslationConfigurationError);

    process.env.OPENAI_API_KEY = "direct-key";
    openAiMocks.parse.mockRejectedValueOnce(new Error("sensitive upstream detail"));
    await expect(provider.translate(request)).rejects.toMatchObject({
      constructor: CatalogTranslationProviderError,
      code: "AI_TRANSLATION_PROVIDER_FAILED",
      message: "翻譯供應器暫時無法使用。",
    });
  });

  it.each([
    [402, "payment_required", "CREDITS_OR_BUDGET"],
    [429, "insufficient_quota", "CREDITS_OR_BUDGET"],
    [429, "rate_limit_exceeded", "RATE_LIMIT"],
    [401, "invalid_token", "AUTHENTICATION"],
    [403, "customer_verification_required", "PERMISSION_OR_VERIFICATION"],
    [404, "model_not_found", "MODEL_OR_ROUTE"],
  ] as const)("安全分類 upstream %i/%s", async (status, code, upstreamFailure) => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "direct-key";
    openAiMocks.parse.mockRejectedValueOnce(Object.assign(new Error("sensitive detail"), {
      status,
      code,
    }));

    await expect(new OpenAiCatalogTranslationProvider().translate(request)).rejects.toMatchObject({
      code: "AI_TRANSLATION_PROVIDER_FAILED",
      upstreamFailure,
      message: "翻譯供應器暫時無法使用。",
    });
  });

  it.each([
    [Object.assign(new Error("network detail"), {}), "UPSTREAM"],
    [Object.assign(new Error("zdr detail"), {
      status: 400,
      type: "no_providers_available",
    }), "MODEL_OR_ROUTE"],
  ] as const)("分類無 status 與 ZDR route failure", async (upstreamError, upstreamFailure) => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "direct-key";
    openAiMocks.parse.mockRejectedValueOnce(upstreamError);

    await expect(new OpenAiCatalogTranslationProvider().translate(request)).rejects.toMatchObject({
      code: "AI_TRANSLATION_PROVIDER_FAILED",
      upstreamFailure,
      message: "翻譯供應器暫時無法使用。",
    });
  });
});
