import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isCatalogAiTranslationConfigured } from "@/server/localization/openai-catalog-translation-provider";

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

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
