import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { TripLinesController } from './trip-lines.controller.js';
import { TripLinesService } from './trip-lines.service.js';
import { GeographyService } from './geography.service.js';
import { RoutesController } from './routes.controller.js';
import { RoutesService } from './routes.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [RoutesController, TripLinesController],
  providers: [RoutesService, TripLinesService, GeographyService],
  exports: [RoutesService, GeographyService],
})
export class RoutesModule {}
