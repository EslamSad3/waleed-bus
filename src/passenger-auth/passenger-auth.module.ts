import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module.js';
import { OtpService } from './otp.service.js';
import { PassengerService } from './passenger.service.js';
import { PassengerAuthController } from './passenger-auth.controller.js';
import { ProvidersService } from './providers.service.js';
import { ThrottleService } from './throttle.service.js';

/**
 * Passenger authentication (spec 002): phone registration + OTP verification,
 * provider (Google/Apple) login, profile completion, and auth/OTP throttling.
 * Services run on the privileged system path (same rationale as AuthService:
 * no identity context exists yet on public routes). Session scope is derived
 * per request from live verification state — see JwtAuthGuard.
 */
@Module({
  imports: [AuditModule, JwtModule.register({})],
  controllers: [PassengerAuthController],
  providers: [OtpService, PassengerService, ProvidersService, ThrottleService],
  exports: [OtpService, PassengerService, ProvidersService, ThrottleService],
})
export class PassengerAuthModule {}
