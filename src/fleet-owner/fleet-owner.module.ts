import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BusLifecycleService } from './bus-lifecycle.service.js';
import { BusTripLineService } from './bus-trip-line.service.js';
import { DriverAssignmentService } from './driver-assignment.service.js';
import { DriverRosterService } from './driver-roster.service.js';
import { FleetOwnerController } from './fleet-owner.controller.js';
import { FleetOwnerService } from './fleet-owner.service.js';
import { FleetOwnersAdminController } from './fleet-owners-admin.controller.js';
import { FleetOwnersAdminService } from './fleet-owners-admin.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule, AuditModule],
  controllers: [FleetOwnerController, FleetOwnersAdminController],
  providers: [FleetOwnerService, FleetOwnersAdminService, BusLifecycleService, DriverRosterService, DriverAssignmentService, BusTripLineService],
  exports: [FleetOwnerService, BusLifecycleService, DriverRosterService, DriverAssignmentService, BusTripLineService],
})
export class FleetOwnerModule {}
