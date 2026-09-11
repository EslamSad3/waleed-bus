import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiConflict,
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { BookingsService } from './bookings.service.js';
import { BookingRatingDto } from '../driver-ops/dto/driver-ops.dto.js';

/**
 * Passenger self-rating (spec 003 US4, contracts/driver.md). No fleet
 * selector: ownership is proven by the verified-phone match inside the
 * service; foreign bookings 404.
 */
@ApiTags('bookings')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Controller('bookings')
export class PassengerRatingController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post(':id/rating')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rate your own booking (COMPLETED trip; one write per side).' })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(200, '{busRating, driverRating}.')
  @ApiNotFound('Booking not found (foreign bookings are also 404).')
  @ApiConflict('409 RATING_NOT_ALLOWED on ineligible state or conflicting re-rating.')
  rate(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BookingRatingDto,
  ) {
    return this.bookingsService.rateByPassenger(actor, id, dto);
  }
}
