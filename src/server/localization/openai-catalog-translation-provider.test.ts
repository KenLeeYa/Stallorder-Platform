import { afterEach, describe, expect, it, vi } from "vitest";
import { APIConnectionTimeoutError, APIError } from "openai";

vi.mock("server-only", () => ({}));

import {
  getCatalogTranslationProviderFailure,
  isCatalogAiTranslationConfigured,
} from "@/server/localization/openai-catalog-translation-provider";

const originalEnabled = process.env.OPENAI_TRANSLATION_ENABLED;
const originalApiKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_TRANSLATION_MODEL;

afterEach(() => {
  restoreEnvironmentVariable("OPENAI_TRANSLATION_ENABLED", originalEnabled);
  restoreEnvironmentVariable("OPENAI_API_KEY", originalApiKey);
  restoreEnvironmentVariable("OPENAI_TRANSLATION_MODEL", originalModel);
});

describe("isCatalogAiTranslationConfigured", () => {
  it("requires the feature flag, API key, and a valid model name", () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_TRANSLATION_MODEL = "gpt-5.2";

    expect(isCatalogAiTranslationConfigured()).toBe(true);
  });

  it.each([
    ["disabled feature flag", "false", "test-key", "gpt-5.2"],
    ["missing API key", "true", "", "gpt-5.2"],
    ["invalid model name", "true", "test-key", "invalid model"],
  ])("returns false for %s", (_scenario, enabled, apiKey, model) => {
    process.env.OPENAI_TRANSLATION_ENABLED = enabled;
    process.env.OPENAI_API_KEY = apiKey;
    process.env.OPENAI_TRANSLATION_MODEL = model;

    expect(isCatalogAiTranslationConfigured()).toBe(false);
  });
});

describe("getCatalogTranslationProviderFailure", () => {
  it("retains only safe API error metadata", () => {
    const error = new APIError(
      401,
      { code: "invalid_api_key", type: "invalid_request_error" },
      "sensitive provider message",
      new Headers(),
    );

    expect(getCatalogTranslationProviderFailure(error)).toEqual({
      providerStatus: 401,
      providerCode: "invalid_api_key",
      providerType: "invalid_request_error",
      providerErrorKind: "API_ERROR",
    });
  });

  it("does not retain messages or untrusted metadata", () => {
    const error = new APIError(
      400,
      { code: "unsafe\nvalue", type: "invalid request" },
      "sensitive provider message",
      new Headers(),
    );

    expect(getCatalogTranslationProviderFailure(error)).toEqual({
      providerStatus: 400,
      providerCode: null,
      providerType: null,
      providerErrorKind: "API_ERROR",
    });
  });

  it("classifies connection timeouts without exposing the error message", () => {
    expect(getCatalogTranslationProviderFailure(new APIConnectionTimeoutError())).toEqual({
      providerStatus: null,
      providerCode: null,
      providerType: null,
      providerErrorKind: "CONNECTION_TIMEOUT",
    });
  });
});

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
