import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import {
  PlatformServiceConfigController,
  ServiceConfigController,
} from './service-config.controller.js';
import { ServiceConfigService } from './service-config.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ServiceConfigController, PlatformServiceConfigController],
  providers: [ServiceConfigService],
  exports: [ServiceConfigService],
})
export class ServiceConfigModule {}
