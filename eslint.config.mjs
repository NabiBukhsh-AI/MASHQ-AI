import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Provider SDKs are only allowed inside the LLM module (src/server/llm/).
  // Everything else must go through the provider module.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/server/llm/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message:
                "Import from src/server/llm/provider instead. Direct SDK use is only allowed inside src/server/llm/.",
            },
            {
              name: "@anthropic-ai/sdk/helpers/zod",
              message:
                "Import from src/server/llm/provider instead. Direct SDK use is only allowed inside src/server/llm/.",
            },
            {
              name: "@google/genai",
              message:
                "Import from src/server/llm/provider instead. Direct SDK use is only allowed inside src/server/llm/.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
