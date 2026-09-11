import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DriverOpsController } from './driver-ops.controller.js';
import { DriverOpsService } from './driver-ops.service.js';
import { DriverTripGuard } from './driver-trip.guard.js';
import { PassengerFeedbackService } from './passenger-feedback.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule, AuditModule],
  controllers: [DriverOpsController],
  providers: [DriverOpsService, DriverTripGuard, PassengerFeedbackService],
  exports: [DriverOpsService, DriverTripGuard, PassengerFeedbackService],
})
export class DriverOpsModule {}
