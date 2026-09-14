import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../authorization/decorators/permissions.decorator.js';
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
import { DriverTripGuard } from './driver-trip.guard.js';
import { DriverOpsService } from './driver-ops.service.js';
import { PassengerFeedbackService } from './passenger-feedback.service.js';
import {
  CashPaymentDto,
  ClaimBusDto,
  DriverTripsQueryDto,
  DropOffDto,
  PassengerRatingDto,
  PassengerReportDto,
  UpdateDriverProfileDto,
} from './dto/driver-ops.dto.js';

/**
 * Driver surface (contracts/driver.md). Every trip/passenger op re-anchors on
 * the in-transaction trip row; the fleet selector travels in `x-fleet-id`.
 */
@ApiTags('driver')
@ApiSecurity('bearer')
@ApiAuthErrors()
@ApiFleetIdHeader()
@Controller('driver')
export class DriverOpsController {
  constructor(
    private readonly driverOps: DriverOpsService,
    private readonly feedback: PassengerFeedbackService,
  ) {}

  @Patch('me')
  @ApiOperation({ summary: 'Update the driver profile (name, picture).' })
  @ApiEnvelopeResponse(200, 'The updated profile.')
  updateMe(
    @CurrentUser() actor: RequestUser,
    @Body() dto: UpdateDriverProfileDto,
  ) {
    return this.driverOps.updateProfile(actor, dto);
  }

  @Get('bus')
  @RequirePermission('driver.context.read')
  @ApiOperation({ summary: 'Return the assigned bus (404 when unassigned).' })
  @ApiEnvelopeResponse(200, 'Active assignment + bus row.')
  @ApiNotFound(
    '404 DRIVER_NOT_ASSIGNED when the caller has no active assignment.',
  )
  assignedBus(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
  ) {
    return this.driverOps.assignedBus(actor, fleetContext);
  }

  @Get('bus/:busId')
  @RequirePermission('driver.context.read')
  @ApiOperation({
    summary: 'Fetch one bus — must equal the assigned bus, else 404.',
  })
  @ApiUuidParam('busId', 'Bus id (uuid).')
  @ApiEnvelopeResponse(200, 'The bus.')
  @ApiNotFound('Bus is not the assigned bus (or not in this fleet).')
  assignedBusById(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('busId', ParseUUIDPipe) busId: string,
  ) {
    return this.driverOps.assignedBusById(actor, fleetContext, busId);
  }

  @Post('bus/claim')
  @RequirePermission('driver.trips.operate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Claim an owned-fleet bus as your operating bus (independent drivers; fleet owners drive their own buses).',
  })
  @ApiEnvelopeResponse(200, 'Active assignment row.')
  @ApiNotFound('Bus not found in this fleet (cross-fleet ids are also 404).')
  @ApiConflict(
    '403 unless the caller owns the fleet; 409 without an ACTIVE driver membership.',
  )
  claimBus(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Body() dto: ClaimBusDto,
  ) {
    return this.driverOps.claimBus(actor, fleetContext, dto.busId);
  }

  @Get('fleet')
  @RequirePermission('driver.context.read')
  @ApiOperation({
    summary: 'Return the fleet name + phone + owner contact (clarify Q5-B).',
  })
  @ApiEnvelopeResponse(200, 'Fleet contact card.')
  fleetCard(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
  ) {
    return this.driverOps.fleetCard(actor, fleetContext);
  }

  @Get('trips')
  @RequirePermission('driver.context.read')
  @ApiOperation({
    summary:
      'List trips on the assigned bus (cursor pagination, optional status filter).',
  })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Cursor page of assigned trips.')
  @ApiNotFound(
    '404 DRIVER_NOT_ASSIGNED when the caller has no active assignment.',
  )
  trips(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Query() query: DriverTripsQueryDto,
  ) {
    return this.driverOps.trips(actor, fleetContext, query);
  }

  @Get('trips/current')
  @RequirePermission('driver.context.read')
  @ApiOperation({
    summary:
      'Nearest DEPARTED (fallback SCHEDULED-today) trip on the assigned bus.',
  })
  @ApiEnvelopeResponse(200, 'The current trip.')
  @ApiNotFound('No current trip on the assigned bus.')
  currentTrip(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
  ) {
    return this.driverOps.currentTrip(actor, fleetContext);
  }

  @Get('trips/:tripId')
  @RequirePermission('driver.context.read')
  @ApiOperation({ summary: 'Fetch one assigned trip (assignment-guarded).' })
  @ApiUuidParam('tripId', 'Trip id (uuid).')
  @ApiEnvelopeResponse(200, 'The trip.')
  @UseGuards(DriverTripGuard)
  @ApiNotFound(
    '404 TRIP_ACCESS_DENIED when the trip is not on the assigned bus.',
  )
  tripById(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ) {
    return this.driverOps.tripById(actor, fleetContext, tripId);
  }

  @Get('trips/:tripId/passengers')
  @RequirePermission('driver.passengers.read')
  @ApiOperation({
    summary: 'Passenger manifest (PRD §9 fields only — no bulk export).',
  })
  @ApiUuidParam('tripId', 'Trip id (uuid).')
  @ApiEnvelopeResponse(
    200,
    'Manifest rows (unpaginated: bounded by bus capacity).',
  )
  @UseGuards(DriverTripGuard)
  @ApiNotFound(
    '404 TRIP_ACCESS_DENIED when the trip is not on the assigned bus.',
  )
  manifest(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ) {
    return this.driverOps.manifest(actor, fleetContext, tripId);
  }

  @Post('trips/:tripId/passengers/:bookingId/board')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('driver.trips.operate')
  @ApiOperation({
    summary:
      'Board a passenger (convergent — repeat returns 200 with current state).',
  })
  @ApiUuidParam('tripId', 'Trip id (uuid).')
  @ApiUuidParam('bookingId', 'Booking id (uuid).')
  @ApiEnvelopeResponse(200, '{boardingStatus, boardedAt}.')
  @UseGuards(DriverTripGuard)
  @ApiConflict('409 on cancelled/foreign bookings or illegal transitions.')
  board(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    return this.driverOps.board(actor, fleetContext, tripId, bookingId);
  }

  @Post('trips/:tripId/passengers/:bookingId/dropoff')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('driver.trips.operate')
  @ApiOperation({ summary: 'Record drop-off (terminal per booking).' })
  @ApiUuidParam('tripId', 'Trip id (uuid).')
  @ApiUuidParam('bookingId', 'Booking id (uuid).')
  @ApiEnvelopeResponse(200, '{dropStatus, droppedAt}.')
  @UseGuards(DriverTripGuard)
  @ApiConflict(
    '409 INVALID_DROPOFF_STATE on conflicting re-drop-off or missing station/reason.',
  )
  dropOff(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: DropOffDto,
  ) {
    return this.driverOps.dropOff(actor, fleetContext, tripId, bookingId, dto);
  }

  @Post('trips/:tripId/passengers/:bookingId/payment')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('driver.trips.operate')
  @ApiOperation({
    summary: 'Mark cash payment PAID (amount is read-only from the booking).',
  })
  @ApiUuidParam('tripId', 'Trip id (uuid).')
  @ApiUuidParam('bookingId', 'Booking id (uuid).')
  @ApiEnvelopeResponse(200, '{paymentStatus, paidAt}.')
  @UseGuards(DriverTripGuard)
  @ApiConflict(
    '409 PAYMENT_NOT_ALLOWED when unboarded, already paid, or method mismatches.',
  )
  cashPayment(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: CashPaymentDto,
  ) {
    return this.driverOps.cashPayment(
      actor,
      fleetContext,
      tripId,
      bookingId,
      dto,
    );
  }

  @Post('trips/:tripId/passengers/:bookingId/rating')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('driver.trips.operate')
  @ApiOperation({
    summary: 'Rate a passenger (COMPLETED trip; one write — change conflicts).',
  })
  @ApiUuidParam('tripId', 'Trip id (uuid).')
  @ApiUuidParam('bookingId', 'Booking id (uuid).')
  @ApiEnvelopeResponse(200, '{passengerRating, ratedAt}.')
  @UseGuards(DriverTripGuard)
  @ApiConflict(
    '409 RATING_NOT_ALLOWED on ineligible state or conflicting re-rating.',
  )
  ratePassenger(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: PassengerRatingDto,
  ) {
    return this.feedback.ratePassenger(
      actor,
      fleetContext,
      tripId,
      bookingId,
      dto.rating,
    );
  }

  @Post('trips/:tripId/passengers/:bookingId/report')
  @RequirePermission('driver.trips.operate')
  @ApiOperation({
    summary: 'File a passenger report (append-only, 1–2000 chars).',
  })
  @ApiUuidParam('tripId', 'Trip id (uuid).')
  @ApiUuidParam('bookingId', 'Booking id (uuid).')
  @ApiEnvelopeResponse(201, 'The created report.')
  @UseGuards(DriverTripGuard)
  @ApiConflict('409 REPORT_NOT_ALLOWED on foreign or cancelled-trip reports.')
  reportPassenger(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: PassengerReportDto,
  ) {
    return this.feedback.reportPassenger(
      actor,
      fleetContext,
      tripId,
      bookingId,
      dto.note,
    );
  }
}
