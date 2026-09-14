import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiAuthErrors, ApiEnvelopeResponse } from '../openapi/api-helpers.js';
import { BookingsService } from './bookings.service.js';
import { ActivePassengerTripDto } from './dto/passenger-booking.dto.js';

@ApiTags('passenger-bookings')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Controller('me')
export class MeController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get('active-trip')
  @ApiOperation({
    summary:
      'Retrieve current day-of-travel active trip context and live tracking descriptor.',
  })
  @ApiEnvelopeResponse(
    200,
    'Active trip context or null if no active trip.',
    ActivePassengerTripDto,
  )
  getActiveTrip(@CurrentUser() actor: RequestUser) {
    return this.bookingsService.findActivePassengerTrip(actor);
  }
}
