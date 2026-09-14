import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  Platform,
  RequirePermission,
} from '../authorization/decorators/permissions.decorator.js';
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
import { FleetsService } from './fleets.service.js';
import {
  CreateFleetDto,
  FleetDto,
  MyMembershipDto,
  UpdateFleetDto,
} from '../users/dto/user.dto.js';

@ApiTags('fleets')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Controller('fleets')
export class FleetsController {
  constructor(private readonly fleetsService: FleetsService) {}

  @Platform()
  @Post()
  @RequirePermission('fleets.create')
  @ApiOperation({
    summary:
      'Create a fleet (platform path; optionally grants the owner an initial membership).',
  })
  @ApiEnvelopeResponse(201, 'Fleet created.', FleetDto)
  @ApiConflict(
    'Owner role slug unknown/inactive, or the owner user cannot be linked.',
  )
  create(@Body() dto: CreateFleetDto, @CurrentUser() actor: RequestUser) {
    return this.fleetsService.create(dto, actor.id);
  }

  @Platform()
  @Get()
  @RequirePermission('fleets.read')
  @ApiOperation({
    summary: 'List all fleets (platform path, cursor pagination).',
  })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'Cursor page of fleets (items + nextCursor).',
    FleetDto,
    true,
  )
  findAll(@Query() query: { cursor?: string; limit?: string }) {
    return this.fleetsService.findAll(query);
  }

  @Get('mine')
  @ApiOperation({
    summary:
      "List the caller's own ACTIVE fleet memberships (RLS tenant path).",
  })
  @ApiEnvelopeResponse(
    200,
    "The caller's ACTIVE memberships — never another user's.",
    MyMembershipDto,
    true,
  )
  mine(@CurrentUser() actor: RequestUser) {
    return this.fleetsService.mine(actor.id);
  }

  @Platform()
  @Get(':id')
  @RequirePermission('fleets.read')
  @ApiOperation({ summary: 'Fetch one fleet by id (platform path).' })
  @ApiUuidParam('id', 'Fleet id (uuid).')
  @ApiEnvelopeResponse(200, 'The fleet.', FleetDto)
  @ApiNotFound('Fleet not found.')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.fleetsService.findOne(id);
  }

  @Platform()
  @Patch(':id')
  @RequirePermission('fleets.update')
  @ApiOperation({ summary: 'Update a fleet (platform path).' })
  @ApiUuidParam('id', 'Fleet id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated fleet.', FleetDto)
  @ApiNotFound('Fleet not found.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFleetDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.fleetsService.update(id, dto, actor.id);
  }

  @Platform()
  @Delete(':id')
  @RequirePermission('fleets.delete')
  @ApiOperation({
    summary: 'Delete a fleet and its memberships (platform path, cascading).',
  })
  @ApiUuidParam('id', 'Fleet id (uuid).')
  @ApiEnvelopeResponse(200, 'Fleet deleted; data is null.')
  @ApiNotFound('Fleet not found.')
  @ApiConflict('Fleet still referenced by buses/trips/bookings.')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.fleetsService.remove(id, actor.id);
  }
}
