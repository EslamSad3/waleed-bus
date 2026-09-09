import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { BusesController } from './buses.controller.js';
import { BusesService } from './buses.service.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [BusesController],
  providers: [BusesService],
})
export class BusesModule {}
