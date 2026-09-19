import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Platform, RequirePermission } from '../authorization/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { ApiAuthErrors, ApiCursorPagination, ApiEnvelopeResponse, ApiNotFound, ApiUuidParam } from '../openapi/api-helpers.js';
import { CreateFleetOwnerDto, UpdateFleetOwnerDto } from './dto/fleet-owners-admin.dto.js';
import { FleetOwnersAdminService } from './fleet-owners-admin.service.js';

@ApiTags('fleet-owners')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('fleet-owners')
export class FleetOwnersAdminController {
  constructor(private readonly owners: FleetOwnersAdminService) {}

  @Get()
  @RequirePermission('users.read')
  @ApiOperation({ summary: 'List all fleet owners across the system.' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Cursor page of fleet owner accounts.')
  findAll(@Query() query: { cursor?: string; limit?: string }) {
    return this.owners.findAll(query);
  }

  @Post()
  @RequirePermission('users.create')
  @ApiOperation({ summary: 'Create a fleet-owner account and its first fleet atomically.' })
  @ApiEnvelopeResponse(201, 'Fleet owner account with its initial fleet.')
  create(@Body() dto: CreateFleetOwnerDto, @CurrentUser() actor: RequestUser) {
    return this.owners.create(dto, actor.id);
  }

  @Get(':id')
  @RequirePermission('users.read')
  @ApiOperation({ summary: 'Get a fleet owner and all fleets they own.' })
  @ApiEnvelopeResponse(200, 'Fleet owner account with owned fleets.')
  @ApiUuidParam('id', 'Fleet owner user id.')
  @ApiNotFound('Fleet owner not found.')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.owners.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('users.update')
  @ApiOperation({ summary: 'Update a fleet-owner account.' })
  @ApiEnvelopeResponse(200, 'Fleet owner account updated.')
  @ApiUuidParam('id', 'Fleet owner user id.')
  @ApiNotFound('Fleet owner not found.')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFleetOwnerDto, @CurrentUser() actor: RequestUser) {
    return this.owners.update(id, dto, actor.id);
  }
}
