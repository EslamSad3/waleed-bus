import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Platform, RequireAllPermissions } from '../authorization/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiConflict,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CreateFleetOwnerDto, FleetOwnerAccountDto, UpdateFleetOwnerDto } from './dto/fleet-owner-admin.dto.js';
import { FleetOwnerAdminService } from './fleet-owner-admin.service.js';

@ApiTags('fleet-owner-admin')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('fleet-owners')
export class FleetOwnerAdminController {
  constructor(private readonly fleetOwners: FleetOwnerAdminService) {}

  @Post()
  @RequireAllPermissions('users.create', 'fleets.create')
  @ApiOperation({ summary: 'Atomically create a fleet-owner account, first fleet, and ACTIVE membership.' })
  @ApiEnvelopeResponse(201, 'Fleet owner and initial fleet created.', FleetOwnerAccountDto)
  @ApiConflict('Phone or national ID is already registered.')
  create(@Body() dto: CreateFleetOwnerDto, @CurrentUser() actor: RequestUser) {
    return this.fleetOwners.create(dto, actor.id);
  }

  @Patch(':id')
  @RequireAllPermissions('users.update', 'fleets.read')
  @ApiOperation({ summary: 'Update a fleet-owner account. Deactivation revokes active sessions.' })
  @ApiUuidParam('id', 'Fleet-owner user id.')
  @ApiEnvelopeResponse(200, 'Fleet owner updated.', FleetOwnerAccountDto)
  @ApiConflict('Phone or national ID is already registered.')
  @ApiNotFound('Fleet owner not found.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFleetOwnerDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.fleetOwners.update(id, dto, actor.id);
  }

  @Get()
  @RequireAllPermissions('users.read', 'fleets.read')
  @ApiOperation({ summary: 'List fleet owners and their owned fleets.' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Cursor page of fleet owners.', FleetOwnerAccountDto, true)
  findAll(@Query() query: { cursor?: string; limit?: string }) {
    return this.fleetOwners.findAll(query);
  }

  @Get(':id')
  @RequireAllPermissions('users.read', 'fleets.read')
  @ApiOperation({ summary: 'Fetch one fleet owner and owned fleets.' })
  @ApiUuidParam('id', 'Fleet-owner user id.')
  @ApiEnvelopeResponse(200, 'Fleet owner.', FleetOwnerAccountDto)
  @ApiNotFound('Fleet owner not found.')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.fleetOwners.findOne(id);
  }
}
