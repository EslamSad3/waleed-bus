import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PassengerAuthModule } from '../passenger-auth/passenger-auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PromotionsModule } from '../promotions/promotions.module.js';
import { AdminBookingsController } from './admin-bookings.controller.js';
import { AdminBookingsService } from './admin-bookings.service.js';
import { AdminBookingsQueryService } from './admin-bookings-query.service.js';
import { AdminPaymentService } from './admin-payment.service.js';
import { AdminBookingLifecycleService } from './admin-booking-lifecycle.service.js';
import { AdminReportService } from './admin-report.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { FleetBookingService } from './fleet-booking.service.js';
import { PassengerBookingService } from './passenger-booking.service.js';
import { PassengerRatingService } from './passenger-rating.service.js';
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
    PromotionsModule,
    NotificationsModule,
  ],
  controllers: [
    BookingsController,
    PassengerBookingsController,
    PassengerRatingController,
    MeController,
    PublicSharesController,
    AdminBookingsController,
  ],
  providers: [
    FleetBookingService,
    PassengerBookingService,
    PassengerRatingService,
    BookingsService,
    TripSharesService,
    AdminBookingsQueryService,
    AdminPaymentService,
    AdminBookingLifecycleService,
    AdminReportService,
    AdminBookingsService,
  ],
  exports: [
    FleetBookingService,
    PassengerBookingService,
    PassengerRatingService,
    BookingsService,
    TripSharesService,
    AdminBookingsQueryService,
    AdminPaymentService,
    AdminBookingLifecycleService,
    AdminReportService,
    AdminBookingsService,
  ],
})
export class BookingsModule {}
