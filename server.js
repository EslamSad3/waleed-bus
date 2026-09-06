/**
 * Vercel Node Backends entrypoint — a root-level `server` file outranks
 * src/main.ts in Vercel's entrypoint detection order.
 *
 * It MUST import the tsc-compiled dist/ output instead of src/*.ts: Vercel
 * bundles the entry source with esbuild, which does not emit decorator
 * parameter metadata (design:paramtypes), and NestJS dependency injection
 * resolves constructor parameters through it. dist/ is produced by tsc with
 * emitDecoratorMetadata, so the metadata is already concrete JS and survives
 * the bundle.
 *
 * Serverless contract: never listen() — init() the app and export the raw
 * Express instance; the runtime bridges incoming requests to it, and the
 * module is evaluated once per warm instance (Nest boots on cold start).
 * `vercel.json` runs `pnpm build` first so dist/ is fresh at bundle time.
 *
 * The `@nestjs/core` import is load-bearing for Vercel: it classifies
 * candidate entrypoints by their framework imports.
 */
import '@nestjs/core';
import { createApp } from './dist/app.bootstrap.js';

const app = await createApp();
await app.init();

export default app.getHttpAdapter().getInstance();
