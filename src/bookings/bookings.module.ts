import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { PassengerRatingController } from './passenger-rating.controller.js';

@Module({
  imports: [AuthorizationModule, PrismaModule],
  controllers: [BookingsController, PassengerRatingController],
  providers: [BookingsService],
})
export class BookingsModule {}
