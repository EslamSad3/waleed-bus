import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Dedicated runner for docs/openapi.json generation (`pnpm docs:generate`).
 * It boots the AppModule through the vitest pipeline (decorator metadata) and
 * writes the checked-in contract file. Never picked up by `pnpm test`.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['src/openapi/generate-openapi-file.spec.ts'],
  },
});
