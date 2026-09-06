import 'dotenv/config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule, ObserveInstrument } from './app.module.js';
import { buildOpenApiDocument } from './openapi/openapi.document.js';

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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // The document is built from the same shared config checked in as
  // docs/openapi.json (`pnpm docs:generate`) — never diverging copies.
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));

  return app;
}
