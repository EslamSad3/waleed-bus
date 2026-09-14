import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PassengerAuthModule } from '../passenger-auth/passenger-auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { MeController } from './me.controller.js';
import { PassengerBookingsController } from './passenger-bookings.controller.js';
import { PassengerRatingController } from './passenger-rating.controller.js';
import { PublicSharesController } from './public-shares.controller.js';
import { TripSharesService } from './trip-shares.service.js';

@Module({
  imports: [
    AuthorizationModule,
    PrismaModule,
    AuditModule,
    PassengerAuthModule,
  ],
  controllers: [
    BookingsController,
    PassengerBookingsController,
    PassengerRatingController,
    MeController,
    PublicSharesController,
  ],
  providers: [BookingsService, TripSharesService],
  exports: [BookingsService, TripSharesService],
})
export class BookingsModule {}
