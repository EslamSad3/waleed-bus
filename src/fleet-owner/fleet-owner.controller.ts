import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Platform, RequirePermission } from '../authorization/decorators/permissions.decorator.js';
import { CurrentFleet } from '../common/decorators/current-fleet.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiConflict,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiFleetIdHeader,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { BusLifecycleService } from './bus-lifecycle.service.js';
import { BusTripLineService } from './bus-trip-line.service.js';
import { DriverAssignmentService } from './driver-assignment.service.js';
import { DriverRosterService } from './driver-roster.service.js';
import { FleetOwnerService } from './fleet-owner.service.js';
import {
  AddDriverDto,
  AssignDriverDto,
  AssignTripLineDto,
  CreateFleetBusDto,
  FleetReportsQueryDto,
  OwnerProfileDto,
  UpdateDriverDto,
  UpdateFleetBusDto,
  UpdateProfileDto,
} from './dto/fleet-owner.dto.js';

/**
 * Fleet-owner surface (contracts/fleet-owner.md). Fleet scope travels in the
 * `x-fleet-id` header (verified server-side into FleetContext); cross-fleet
 * ids → 404, never 403.
 */
@ApiTags('fleet-owner')
@ApiSecurity('bearer')
@ApiAuthErrors()
@ApiFleetIdHeader()
@Controller()
export class FleetOwnerController {
  constructor(
    private readonly fleetOwner: FleetOwnerService,
    private readonly lifecycle: BusLifecycleService,
    private readonly roster: DriverRosterService,
    private readonly assignment: DriverAssignmentService,
    private readonly tripLines: BusTripLineService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary:
      'Return the caller profile (owner and driver share this endpoint).',
  })
  @ApiEnvelopeResponse(200, 'The caller profile.', OwnerProfileDto)
  getMe(@CurrentUser() actor: RequestUser) {
    return this.fleetOwner.getProfile(actor.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the caller profile (name, picture).' })
  @ApiEnvelopeResponse(200, 'The updated profile.', OwnerProfileDto)
  updateMe(@CurrentUser() actor: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.fleetOwner.updateProfile(actor.id, dto);
  }

  @Platform()
  @Get('drivers')
  @RequirePermission('fleet.drivers.read')
  @ApiOperation({ summary: 'List every driver membership for platform operations, with fleet, owner, and active bus assignment.' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Cursor page of system driver memberships.')
  listSystemDrivers(@Query() query: { cursor?: string; limit?: string }) {
    return this.roster.listSystem(query);
  }

  @Get('fleet/buses')
  @RequirePermission('fleet.buses.read')
  @ApiOperation({ summary: 'List the owned fleet buses (cursor pagination).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Cursor page of owned buses.')
  listBuses(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.fleetOwner.listBuses(actor, fleetContext, query);
  }

  @Post('fleet/buses')
  @RequirePermission('fleet.buses.create')
  @ApiOperation({ summary: 'Add a bus to the owned fleet.' })
  @ApiEnvelopeResponse(201, 'Bus created.')
  @ApiConflict('registrationNumber already exists in this fleet.')
  createBus(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Body() dto: CreateFleetBusDto,
  ) {
    return this.fleetOwner.createBus(actor, fleetContext, dto);
  }

  @Get('fleet/buses/:busId')
  @RequirePermission('fleet.buses.read')
  @ApiOperation({ summary: 'Fetch one owned bus.' })
  @ApiUuidParam('busId', 'Bus id (uuid).')
  @ApiEnvelopeResponse(200, 'The bus.')
  @ApiNotFound('Bus not found in this fleet (cross-fleet ids are also 404).')
  getBus(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('busId', ParseUUIDPipe) busId: string,
  ) {
    return this.fleetOwner.getBus(actor, fleetContext, busId);
  }

  @Patch('fleet/buses/:busId')
  @RequirePermission('fleet.buses.update')
  @ApiOperation({ summary: 'Modify an owned bus (plate, capacity).' })
  @ApiUuidParam('busId', 'Bus id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated bus.')
  @ApiNotFound('Bus not found in this fleet (cross-fleet ids are also 404).')
  updateBus(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('busId', ParseUUIDPipe) busId: string,
    @Body() dto: UpdateFleetBusDto,
  ) {
    return this.fleetOwner.updateBus(actor, fleetContext, busId, dto);
  }

  @Post('fleet/buses/:busId/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fleet.buses.update')
  @ApiOperation({
    summary: 'Disable an owned bus (blocked while a DEPARTED trip runs on it).',
  })
  @ApiUuidParam('busId', 'Bus id (uuid).')
  @ApiEnvelopeResponse(200, 'Disabled bus.')
  @ApiConflict(
    '409 BUS_ACTION_NOT_ALLOWED while a DEPARTED trip runs on the bus.',
  )
  disableBus(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('busId', ParseUUIDPipe) busId: string,
  ) {
    return this.lifecycle.disable(actor, fleetContext, busId);
  }

  @Post('fleet/buses/:busId/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fleet.buses.update')
  @ApiOperation({ summary: 'Reactivate an owned bus.' })
  @ApiUuidParam('busId', 'Bus id (uuid).')
  @ApiEnvelopeResponse(200, 'Reactivated bus.')
  reactivateBus(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('busId', ParseUUIDPipe) busId: string,
  ) {
    return this.lifecycle.reactivate(actor, fleetContext, busId);
  }

  @Get('fleet/buses/:busId/trips')
  @RequirePermission('fleet.trips.read')
  @ApiOperation({
    summary: 'List owned trips scheduled on one bus (cursor pagination).',
  })
  @ApiUuidParam('busId', 'Bus id (uuid).')
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Cursor page of trips for the bus.')
  @ApiNotFound('Bus not found in this fleet (cross-fleet ids are also 404).')
  listBusTrips(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('busId', ParseUUIDPipe) busId: string,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.fleetOwner.listBusTrips(actor, fleetContext, busId, query);
  }

  @Get('fleet/trips')
  @RequirePermission('fleet.trips.read')
  @ApiOperation({
    summary: 'List owned fleet trips (cursor pagination, read-only in v1).',
  })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Cursor page of owned trips.')
  listTrips(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.fleetOwner.listTrips(actor, fleetContext, query);
  }

  @Get('fleet/trips/:tripId')
  @RequirePermission('fleet.trips.read')
  @ApiOperation({ summary: 'Fetch one owned trip.' })
  @ApiUuidParam('tripId', 'Trip id (uuid).')
  @ApiEnvelopeResponse(200, 'The trip.')
  @ApiNotFound('Trip not found in this fleet (cross-fleet ids are also 404).')
  getTrip(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ) {
    return this.fleetOwner.getTrip(actor, fleetContext, tripId);
  }

  @Post('fleet/drivers')
  @RequirePermission('fleet.drivers.create')
  @ApiOperation({
    summary:
      'Invite a driver (existing user or fresh phone+password account) with an ACTIVE membership.',
  })
  @ApiEnvelopeResponse(201, 'Driver membership created.')
  @ApiNotFound('Target user not found (or driver role missing).')
  @ApiConflict(
    '409 DRIVER_ASSIGNMENT_NOT_ALLOWED when the role is not driver-capable.',
  )
  addDriver(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Body() dto: AddDriverDto,
  ) {
    return this.roster.add(actor, fleetContext, dto);
  }

  @Get('fleet/drivers')
  @RequirePermission('fleet.drivers.read')
  @ApiOperation({
    summary: 'List driver memberships of the owned fleet (cursor pagination).',
  })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Cursor page of driver memberships.')
  listDrivers(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.roster.list(actor, fleetContext, query);
  }

  @Get('fleet/drivers/:driverId')
  @RequirePermission('fleet.drivers.read')
  @ApiOperation({ summary: 'Fetch one driver membership.' })
  @ApiUuidParam('driverId', 'Membership id (uuid).')
  @ApiEnvelopeResponse(200, 'The driver membership.')
  @ApiNotFound('Driver not found in this fleet (cross-fleet ids are also 404).')
  getDriver(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('driverId', ParseUUIDPipe) driverId: string,
  ) {
    return this.roster.get(actor, fleetContext, driverId);
  }

  @Patch('fleet/drivers/:driverId')
  @RequirePermission('fleet.drivers.update')
  @ApiOperation({
    summary:
      'Update a driver membership (role/status); bumps authVersion and revokes sessions.',
  })
  @ApiUuidParam('driverId', 'Membership id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated driver membership.')
  @ApiNotFound('Driver not found in this fleet (cross-fleet ids are also 404).')
  updateDriver(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Body() dto: UpdateDriverDto,
  ) {
    return this.roster.update(actor, fleetContext, driverId, dto);
  }

  @Delete('fleet/drivers/:driverId')
  @RequirePermission('fleet.drivers.delete')
  @ApiOperation({
    summary:
      'Remove a driver (ends membership + active assignment; bumps authVersion).',
  })
  @ApiUuidParam('driverId', 'Membership id (uuid).')
  @ApiEnvelopeResponse(200, 'Driver removed; data is null.')
  @ApiNotFound('Driver not found in this fleet (cross-fleet ids are also 404).')
  removeDriver(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('driverId', ParseUUIDPipe) driverId: string,
  ) {
    return this.roster.remove(actor, fleetContext, driverId);
  }

  @Post('fleet/buses/:busId/driver')
  @RequirePermission('fleet.drivers.update')
  @ApiOperation({
    summary:
      'Assign a driver to a bus (ends the prior ACTIVE row; idempotent).',
  })
  @ApiUuidParam('busId', 'Bus id (uuid).')
  @ApiEnvelopeResponse(201, 'Active assignment row.')
  @ApiConflict(
    '409 DRIVER_ASSIGNMENT_NOT_ALLOWED when the target is inactive or foreign.',
  )
  assignDriver(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('busId', ParseUUIDPipe) busId: string,
    @Body() dto: AssignDriverDto,
  ) {
    return this.assignment.assign(actor, fleetContext, busId, dto.driverUserId);
  }

  @Delete('fleet/buses/:busId/driver')
  @RequirePermission('fleet.drivers.delete')
  @ApiOperation({
    summary: 'Unassign the active driver of a bus (row → ENDED, history kept).',
  })
  @ApiUuidParam('busId', 'Bus id (uuid).')
  @ApiEnvelopeResponse(200, 'Driver unassigned; data is null.')
  @ApiNotFound(
    'Bus not found, or no active assignment (cross-fleet ids are also 404).',
  )
  unassignDriver(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('busId', ParseUUIDPipe) busId: string,
  ) {
    return this.assignment.unassign(actor, fleetContext, busId);
  }

  @Post('fleet/buses/:busId/trip-line')
  @RequirePermission('fleet.buses.update')
  @ApiOperation({ summary: 'Assign a platform-defined trip line to a bus.' })
  assignTripLine(@CurrentUser() actor: RequestUser, @CurrentFleet() fleetContext: FleetContext, @Param('busId', ParseUUIDPipe) busId: string, @Body() dto: AssignTripLineDto) {
    return this.tripLines.assign(actor, fleetContext, busId, dto.tripLineId);
  }

  @Delete('fleet/buses/:busId/trip-line')
  @RequirePermission('fleet.buses.update')
  @ApiOperation({ summary: 'Remove the current trip line from a bus.' })
  unassignTripLine(@CurrentUser() actor: RequestUser, @CurrentFleet() fleetContext: FleetContext, @Param('busId', ParseUUIDPipe) busId: string) {
    return this.tripLines.unassign(actor, fleetContext, busId);
  }

  @Get('fleet/reports')
  @RequirePermission('fleet.reports.read')
  @ApiOperation({
    summary: 'Read fleet reports + rating summary (clarify Q4-A shape).',
  })
  @ApiEnvelopeResponse(
    200,
    '{reports, ratingSummary} scoped to the owned fleet.',
  )
  getReports(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Query() query: FleetReportsQueryDto,
  ) {
    return this.fleetOwner.getReports(actor, fleetContext, query);
  }
}
