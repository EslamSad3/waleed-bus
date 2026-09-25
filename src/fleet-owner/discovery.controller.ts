import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import {
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import { BusDto } from '../buses/dto/bus.dto.js';
import { DiscoveryService } from './discovery.service.js';
import { FleetOwnerSearchItemDto, FleetOwnerSearchQueryDto } from './dto/discovery.dto.js';

@ApiTags('discovery')
@Controller('public/discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Get('fleet-owners')
  @ApiOperation({
    summary:
      'Discover fleet owners by name or route geography, grouped by owner and VIP-ordered. No seat-availability filter.',
  })
  @ApiEnvelopeResponse(
    200,
    'Owner groups with nested fleets and best VIP rank.',
    FleetOwnerSearchItemDto,
    true,
  )
  search(@Query() query: FleetOwnerSearchQueryDto) {
    return this.discovery.searchFleetOwners(query);
  }

  @Public()
  @Get('fleet-owners/:fleetId/buses')
  @ApiOperation({
    summary: 'List active buses of one fleet with vehicle details and assigned driver.',
  })
  @ApiUuidParam('fleetId', 'Fleet id.')
  @ApiEnvelopeResponse(200, 'Active buses of the fleet.', BusDto, true)
  @ApiNotFound('Fleet not found.')
  fleetBuses(@Param('fleetId', ParseUUIDPipe) fleetId: string) {
    return this.discovery.fleetBuses(fleetId);
  }
}
