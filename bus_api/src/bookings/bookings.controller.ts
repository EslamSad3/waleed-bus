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
import { RequireAnyPermission, RequirePermission } from '../authorization/decorators/permissions.decorator.js';
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
import { BookingsService } from './bookings.service.js';
import { BookingDto, CreateBookingDto, UpdateBookingDto } from '../trips/dto/trip.dto.js';

@ApiTags('bookings')
@ApiSecurity('bearer')
@ApiAuthErrors()
@ApiFleetIdParam()
@Controller('fleets/:fleetId/bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @RequirePermission('bookings.create')
  @ApiOperation({ summary: 'Create a booking for one of the fleet trips.' })
  @ApiEnvelopeResponse(201, 'Booking created (defaults to CONFIRMED).', BookingDto)
  @ApiNotFound('Trip not found in this fleet (cross-fleet trip ids are also 404).')
  create(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingsService.create(actor, fleetContext, dto);
  }

  @Get()
  @RequireAnyPermission('bookings.read', 'bookings.create')
  @ApiOperation({ summary: 'List the fleet bookings (cursor pagination).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Cursor page of bookings (items + nextCursor).', BookingDto, true)
  list(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.bookingsService.findAll(actor, fleetContext, query);
  }

  @Get(':id')
  @RequirePermission('bookings.read')
  @ApiOperation({ summary: 'Fetch one booking.' })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(200, 'The booking.', BookingDto)
  @ApiNotFound('Booking not found in this fleet (cross-fleet ids are also 404).')
  findOne(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookingsService.findOne(actor, fleetContext, id);
  }

  @Patch(':id')
  @RequirePermission('bookings.update')
  @ApiOperation({ summary: 'Update a booking (passenger/phone/status).' })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated booking.', BookingDto)
  @ApiNotFound('Booking not found in this fleet (cross-fleet ids are also 404).')
  update(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookingDto,
  ) {
    return this.bookingsService.update(actor, fleetContext, id, dto);
  }

  @Delete(':id')
  @RequirePermission('bookings.delete')
  @ApiOperation({ summary: 'Delete a booking.' })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(200, 'Booking deleted; data is null.')
  @ApiNotFound('Booking not found in this fleet (cross-fleet ids are also 404).')
  remove(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookingsService.remove(actor, fleetContext, id);
  }
}
