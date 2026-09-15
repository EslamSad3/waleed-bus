import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { buildValidationPipe } from '../../src/common/validation/validation-pipe.js';
import {
  SystemPrismaService,
  TenantPrismaService,
} from '../../src/prisma/prisma.module.js';

export interface TestApp {
  app: INestApplication;
  system: SystemPrismaService;
  tenant: TenantPrismaService;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return {
    app,
    system: app.get(SystemPrismaService),
    tenant: app.get(TenantPrismaService),
    close: () => app.close(),
  };
}
