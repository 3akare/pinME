import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Two projects: node unit tests, and Workers-runtime integration tests
// (`*.integration.test.ts`) that run inside workerd via the Cloudflare plugin.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          // Crypto-heavy property tests can exceed 5 s when many worker files run in parallel.
          testTimeout: 30_000,
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/**/*.integration.test.ts", "**/node_modules/**"],
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
        test: {
          name: "workers",
          // Cold workerd/DO startup can exceed 5 s under parallel load.
          testTimeout: 30_000,
          include: ["src/**/*.integration.test.ts"],
        },
      },
    ],
  },
});
