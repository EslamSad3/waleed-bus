import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BusLifecycleService } from './bus-lifecycle.service.js';
import { DriverAssignmentService } from './driver-assignment.service.js';
import { DriverRosterService } from './driver-roster.service.js';
import { FleetOwnerController } from './fleet-owner.controller.js';
import { FleetOwnerService } from './fleet-owner.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule, AuditModule],
  controllers: [FleetOwnerController],
  providers: [
    FleetOwnerService,
    BusLifecycleService,
    DriverRosterService,
    DriverAssignmentService,
  ],
  exports: [
    FleetOwnerService,
    BusLifecycleService,
    DriverRosterService,
    DriverAssignmentService,
  ],
})
export class FleetOwnerModule {}
