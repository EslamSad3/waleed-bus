import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { FleetsModule } from '../fleets/fleets.module.js';
import { PassengerAuthModule } from '../passenger-auth/passenger-auth.module.js';

@Module({
  imports: [JwtModule.register({}), AuthorizationModule, AuditModule, PassengerAuthModule, FleetsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Global guard #1 — every route requires a JWT unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
