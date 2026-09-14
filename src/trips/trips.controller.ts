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
  RequireAnyPermission,
  RequirePermission,
} from '../authorization/decorators/permissions.decorator.js';
import { CurrentFleet } from '../common/decorators/current-fleet.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiFleetIdParam,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { TripsService } from './trips.service.js';
import { CreateTripDto, TripDto, UpdateTripDto } from './dto/trip.dto.js';

@ApiTags('trips')
@ApiSecurity('bearer')
@ApiAuthErrors()
@ApiFleetIdParam()
@Controller('fleets/:fleetId/trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  @RequirePermission('trips.create')
  @ApiOperation({ summary: 'Schedule a trip with one of the fleet buses.' })
  @ApiEnvelopeResponse(201, 'Trip created (defaults to SCHEDULED).', TripDto)
  @ApiNotFound(
    'Bus not found in this fleet (cross-fleet bus ids are also 404).',
  )
  create(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Body() dto: CreateTripDto,
  ) {
    return this.tripsService.create(actor, fleetContext, dto);
  }

  @Get()
  @RequireAnyPermission('trips.read', 'trips.create')
  @ApiOperation({ summary: 'List the fleet trips (cursor pagination).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'Cursor page of trips (items + nextCursor).',
    TripDto,
    true,
  )
  list(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.tripsService.findAll(actor, fleetContext, query);
  }

  @Get(':id')
  @RequirePermission('trips.read')
  @ApiOperation({ summary: 'Fetch one trip.' })
  @ApiUuidParam('id', 'Trip id (uuid).')
  @ApiEnvelopeResponse(200, 'The trip.', TripDto)
  @ApiNotFound('Trip not found in this fleet (cross-fleet ids are also 404).')
  findOne(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tripsService.findOne(actor, fleetContext, id);
  }

  @Patch(':id')
  @RequirePermission('trips.update')
  @ApiOperation({ summary: 'Update a trip (route/timing/status).' })
  @ApiUuidParam('id', 'Trip id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated trip.', TripDto)
  @ApiNotFound('Trip not found in this fleet (cross-fleet ids are also 404).')
  update(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTripDto,
  ) {
    return this.tripsService.update(actor, fleetContext, id, dto);
  }

  @Delete(':id')
  @RequirePermission('trips.delete')
  @ApiOperation({ summary: 'Delete a trip.' })
  @ApiUuidParam('id', 'Trip id (uuid).')
  @ApiEnvelopeResponse(200, 'Trip deleted; data is null.')
  @ApiNotFound('Trip not found in this fleet (cross-fleet ids are also 404).')
  remove(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tripsService.remove(actor, fleetContext, id);
  }
}
