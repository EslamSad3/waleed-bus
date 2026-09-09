import { configDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Coverage gate (`pnpm test:cov`): runs the unit specs AND the e2e suites in
 * one pass, because most service paths are exercised end-to-end. Measures
 * application code only (no generated Prisma client, no spec files).
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    // docs/openapi.json generation runs only via `pnpm docs:generate`.
    exclude: [...configDefaults.exclude, 'src/openapi/generate-openapi-file.spec.ts'],
    globalSetup: './test/global-setup.ts',
    setupFiles: ['./test/setup-e2e.ts'],
    // Tenant-isolation suites share one database and must run serially.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/main.ts', '**/*.spec.ts', '**/*.e2e-spec.ts', '**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 70,
        statements: 75,
        branches: 70,
      },
    },
  },
});
