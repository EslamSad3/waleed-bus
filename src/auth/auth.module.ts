import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';

@Module({
  imports: [JwtModule.register({}), AuthorizationModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Global guard #1 — every route requires a JWT unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
