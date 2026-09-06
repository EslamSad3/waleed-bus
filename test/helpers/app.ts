import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { SystemPrismaService, TenantPrismaService } from '../../src/prisma/prisma.module.js';

export interface TestApp {
  app: INestApplication;
  system: SystemPrismaService;
  tenant: TenantPrismaService;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  return {
    app,
    system: app.get(SystemPrismaService),
    tenant: app.get(TenantPrismaService),
    close: () => app.close(),
  };
}
