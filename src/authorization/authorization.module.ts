import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from './guards/permission.guard.js';
import { TenantContextGuard } from './guards/tenant-context.guard.js';
import { AuthorizationService } from './services/authorization.service.js';
import { FleetPathService } from './services/fleet-path.service.js';
import { TenantContextService } from './services/tenant-context.service.js';

@Module({
  providers: [
    TenantContextService,
    AuthorizationService,
    FleetPathService,
    // Global guards #2 and #3 (run after JwtAuthGuard, which AuthModule
    // registers first).
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [TenantContextService, AuthorizationService, FleetPathService],
})
export class AuthorizationModule {}
