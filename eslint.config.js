import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const LIBSODIUM = {
  name: "libsodium-wrappers",
  message: "libsodium-wrappers may only be imported under src/client/crypto.",
};
const IDB = {
  name: "idb",
  message: "idb may only be imported under src/client/storage.",
};

export default tseslint.config(
  { ignores: ["dist", ".wrangler", ".output", ".tanstack", "node_modules", "worker-configuration.d.ts", "src/routeTree.gen.ts", "src/db/migrations"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },

  // Import restrictions (Req 18.12, 18.13). Each block replaces the previous
  // no-restricted-imports setting for its files, so every block is complete.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { paths: [LIBSODIUM, IDB] }] },
  },
  {
    files: ["src/client/crypto/**"],
    rules: { "no-restricted-imports": ["error", { paths: [IDB] }] },
  },
  {
    files: ["src/client/storage/**"],
    rules: { "no-restricted-imports": ["error", { paths: [LIBSODIUM] }] },
  },
  {
    // Server-side layers must not depend on the client layer.
    files: ["src/durable/**", "src/server/**", "src/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [LIBSODIUM, IDB],
          patterns: [
            {
              // Anchored on the src/client directory; must not match src/db/client.ts.
              group: [
                "../client",
                "../client/**",
                "../../client",
                "../../client/**",
                "@/client",
                "@/client/**",
                "~/client",
                "~/client/**",
              ],
              message: "durable, server and db must not import from src/client.",
            },
          ],
        },
      ],
      // Never log free-form payloads (Req 17.3); use safeLog.
      "no-console": "error",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Tests may use loose typing and cross-layer imports (e.g. client crypto to build fixtures).
    files: ["**/*.test.{ts,tsx}", "test/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "no-restricted-imports": "off",
    },
  },
);
