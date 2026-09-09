import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule, ObserveInstrument } from './app.module.js';
import { buildValidationPipe } from './common/validation/validation-pipe.js';
import { buildOpenApiDocument } from './openapi/openapi.document.js';
import { swaggerUiCdnRedirect } from './swagger-ui-assets.js';

/**
 * Builds the fully configured application (validation pipe, Swagger, envelope)
 * without binding a port. Shared by the long-running entrypoint (main.ts) and
 * the serverless entry (server.js), which must only init() and export the
 * Express instance — never listen() — so Vercel can bridge requests to it.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  app.useGlobalPipes(buildValidationPipe());

  // The document is built from the same shared config checked in as
  // docs/openapi.json (`pnpm docs:generate`) — never diverging copies.
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));

  // express.static serves the Swagger UI files from disk, which serverless
  // bundlers cannot see (nothing imports them). When such a file falls
  // through, redirect to a pinned-major CDN copy instead of 404ing; on a
  // normal server the files exist and this never fires.
  app.use('/docs', (req: Request, res: Response, next: NextFunction) => {
    const redirect = swaggerUiCdnRedirect(req.path);
    if (redirect) {
      res.redirect(redirect);
      return;
    }
    next();
  });

  return app;
}
