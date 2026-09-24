import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BusesController } from './buses.controller.js';
import { BusesService } from './buses.service.js';
import { VehicleBrandService } from './vehicle-brand.service.js';
import { VehicleBrandsController } from './vehicle-brands.controller.js';

@Module({
  imports: [AuditModule, AuthorizationModule, PrismaModule],
  controllers: [BusesController, VehicleBrandsController],
  providers: [BusesService, VehicleBrandService],
  exports: [BusesService, VehicleBrandService],
})
export class BusesModule {}
