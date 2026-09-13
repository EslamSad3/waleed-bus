import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BusLifecycleService } from './bus-lifecycle.service.js';
import { DriverAssignmentService } from './driver-assignment.service.js';
import { DriverRosterService } from './driver-roster.service.js';
import { FleetOwnerController } from './fleet-owner.controller.js';
import { FleetOwnerAdminController } from './fleet-owner-admin.controller.js';
import { FleetOwnerAdminService } from './fleet-owner-admin.service.js';
import { FleetOwnerService } from './fleet-owner.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule, AuditModule],
  controllers: [FleetOwnerController, FleetOwnerAdminController],
  providers: [FleetOwnerService, FleetOwnerAdminService, BusLifecycleService, DriverRosterService, DriverAssignmentService],
  exports: [FleetOwnerService, FleetOwnerAdminService, BusLifecycleService, DriverRosterService, DriverAssignmentService],
})
export class FleetOwnerModule {}
