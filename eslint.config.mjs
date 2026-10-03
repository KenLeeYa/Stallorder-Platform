import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Expo loads build plugins through CommonJS; this file is not a runtime entry.
  {
    files: ["apps/mobile/plugins/local-loopback.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Review scratch and extracted third-party artifacts are not product inputs.
    ".superpowers/**",
    "out/**",
    "build/**",
    "playwright-report/**",
    "test-results/**",
    "public/vendor/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
