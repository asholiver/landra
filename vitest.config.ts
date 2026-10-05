import { defineConfig } from "vitest/config";

// Two projects so unit tests never need a database and integration tests
// always do. `pnpm test` runs the unit project; `pnpm test:integration` runs
// the integration project (needs DATABASE_URL).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["app/**/*.test.{ts,tsx}", "src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
