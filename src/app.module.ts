import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor.js';
import { AuthModule } from './auth/auth.module.js';
import { AuditModule } from './audit/audit.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { BusesModule } from './buses/buses.module.js';
import { resolveObserveCredentials } from './config/configuration.js';
import { ConfigModule } from './config/config.module.js';
import { DriverOpsModule } from './driver-ops/driver-ops.module.js';
import { FleetsModule } from './fleets/fleets.module.js';
import { FleetOwnerModule } from './fleet-owner/fleet-owner.module.js';
import { HealthController, RootController } from './health.controller.js';
import { PassengerAuthModule } from './passenger-auth/passenger-auth.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RolesModule } from './roles/roles.module.js';
import { RoutesModule } from './routes/routes.module.js';
import { TripsModule } from './trips/trips.module.js';
import { UsersModule } from './users/users.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

// Telemetry only activates with real credentials; placeholder/missing keys
// would leave the agent 401-ing against the collector forever.
const observeCredentials = resolveObserveCredentials();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ...(observeCredentials
      ? [
          ObserveModule.forRoot({
            appKey: observeCredentials.appKey,
            appSecret: observeCredentials.appSecret,
            serviceId: observeCredentials.serviceId,
          }),
        ]
      : []),
    ConfigModule,
    PrismaModule,
    AuthModule,
    AuditModule,
    RolesModule,
    PermissionsModule,
    UsersModule,
    FleetsModule,
    BusesModule,
    TripsModule,
    RoutesModule,
    BookingsModule,
    PassengerAuthModule,
    FleetOwnerModule,
    DriverOpsModule,
  ],
  controllers: [HealthController, RootController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
