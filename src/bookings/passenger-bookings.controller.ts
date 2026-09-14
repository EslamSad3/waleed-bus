import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import { BookingsService } from './bookings.service.js';
import {
  CancelPassengerBookingDto,
  CancelledBookingResponseDto,
  CreatePassengerBookingDto,
  PassengerBookingItemDto,
  PassengerBookingListQueryDto,
} from './dto/passenger-booking.dto.js';
import { CreateTripShareResponseDto } from './dto/trip-share.dto.js';
import { TripSharesService } from './trip-shares.service.js';

@ApiTags('passenger-bookings')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Controller('bookings')
export class PassengerBookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly tripSharesService: TripSharesService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Atomically reserve 1 to N seats on a scheduled trip.',
  })
  @ApiEnvelopeResponse(
    201,
    'Booking confirmed and seats reserved.',
    PassengerBookingItemDto,
  )
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreatePassengerBookingDto,
  ) {
    return this.bookingsService.createPassengerBooking(actor, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'Retrieve personal booking history and upcoming trips with cursor pagination.',
  })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'List of passenger bookings.',
    PassengerBookingItemDto,
    true,
  )
  list(
    @CurrentUser() actor: RequestUser,
    @Query() query: PassengerBookingListQueryDto,
  ) {
    return this.bookingsService.findPassengerBookings(actor, query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Retrieve comprehensive details for an individual booking owned by the passenger.',
  })
  @ApiUuidParam('id', 'Booking UUID')
  @ApiEnvelopeResponse(200, 'Booking details.', PassengerBookingItemDto)
  @ApiNotFound('Booking not found.')
  getById(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookingsService.findPassengerBookingById(actor, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel an active booking (full or partial) before trip departure.',
  })
  @ApiUuidParam('id', 'Booking UUID')
  @ApiEnvelopeResponse(
    200,
    'Booking cancelled and seats restored to capacity.',
    CancelledBookingResponseDto,
  )
  @ApiNotFound('Booking not found.')
  cancel(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPassengerBookingDto,
  ) {
    return this.bookingsService.cancelPassengerBooking(actor, id, dto);
  }

  @Post(':id/share')
  @ApiOperation({
    summary:
      'Generate a secure 6-digit share code and tracking link for a confirmed booking.',
  })
  @ApiUuidParam('id', 'Booking UUID')
  @ApiEnvelopeResponse(201, 'Trip share created.', CreateTripShareResponseDto)
  @ApiNotFound('Booking not found.')
  createShare(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tripSharesService.createTripShare(actor, id);
  }
}
