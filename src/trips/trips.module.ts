import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { TripsController } from './trips.controller.js';
import { TripsSearchController } from './trips-search.controller.js';
import { TripsService } from './trips.service.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [TripsController, TripsSearchController],
  providers: [TripsService],
})
export class TripsModule {}
