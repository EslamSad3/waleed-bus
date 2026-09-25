import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BusLifecycleService } from './bus-lifecycle.service.js';
import { BusTripLineService } from './bus-trip-line.service.js';
import { DriverAssignmentService } from './driver-assignment.service.js';
import { DriverRosterService } from './driver-roster.service.js';
import { DiscoveryController } from './discovery.controller.js';
import { DiscoveryService } from './discovery.service.js';
import { FleetOwnerController } from './fleet-owner.controller.js';
import { FleetOwnerService } from './fleet-owner.service.js';
import { FleetOwnersAdminController } from './fleet-owners-admin.controller.js';
import { FleetOwnersAdminService } from './fleet-owners-admin.service.js';
import { VipTierService } from './vip-tier.service.js';
import { VipTiersController } from './vip-tiers.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule, AuditModule],
  controllers: [FleetOwnerController, FleetOwnersAdminController, DiscoveryController, VipTiersController],
  providers: [FleetOwnerService, FleetOwnersAdminService, BusLifecycleService, DriverRosterService, DriverAssignmentService, BusTripLineService, DiscoveryService, VipTierService],
  exports: [FleetOwnerService, BusLifecycleService, DriverRosterService, DriverAssignmentService, BusTripLineService, DiscoveryService, VipTierService],
})
export class FleetOwnerModule {}
