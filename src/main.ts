import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule, ObserveInstrument } from './app.module.js';
import { buildOpenApiDocument } from './openapi/openapi.document.js';

async function bootstrap() {
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

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
