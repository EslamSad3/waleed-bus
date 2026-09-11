import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { FleetsController } from './fleets.controller.js';
import { FleetsService } from './fleets.service.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';

@Module({
  imports: [AuditModule, AuthorizationModule],
  controllers: [FleetsController, MembersController],
  providers: [FleetsService, MembersService],
  exports: [FleetsService, MembersService],
})
export class FleetsModule {}
