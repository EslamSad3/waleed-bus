import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import {
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import {
  TripDetailsResponseDto,
  TripSearchQueryDto,
  TripSearchResultItemDto,
} from './dto/trip-search.dto.js';
import { TripsService } from './trips.service.js';

@ApiTags('passenger-trips')
@Controller('trips')
export class TripsSearchController {
  constructor(private readonly tripsService: TripsService) {}

  @Public()
  @Get('search')
  @ApiOperation({
    summary:
      'Search scheduled trips by origin, destination, and calendar date with available seats.',
  })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'List of scheduled trips matching search criteria.',
    TripSearchResultItemDto,
    true,
  )
  search(@Query() query: TripSearchQueryDto) {
    return this.tripsService.searchTrips(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary:
      'Retrieve detailed information for a trip including stations and available seats.',
  })
  @ApiUuidParam('id', 'Trip UUID')
  @ApiEnvelopeResponse(
    200,
    'Trip details with ordered stations and vehicle information.',
    TripDetailsResponseDto,
  )
  @ApiNotFound('Trip not found.')
  getDetails(@Param('id', ParseUUIDPipe) id: string) {
    return this.tripsService.findTripDetails(id);
  }
}
