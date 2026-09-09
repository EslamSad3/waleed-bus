import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
