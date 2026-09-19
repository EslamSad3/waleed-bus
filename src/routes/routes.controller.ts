import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiEnvelopeResponse, ApiNotFound } from '../openapi/api-helpers.js';
import { PublicRouteResponseDto } from './dto/route.dto.js';
import { RoutesService } from './routes.service.js';

@ApiTags('routes')
@Controller('public/routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Public()
  @Get('stops')
  @ApiOperation({ summary: 'List active system stop points for the passenger trip planner.' })
  @ApiEnvelopeResponse(200, 'Active stop points available for public trip search.')
  stops() {
    return this.routesService.listPublicStops();
  }

  @Public()
  @Get(':identifier')
  @ApiOperation({
    summary:
      'Resolve route details, ordered stations, and upcoming scheduled trips from a QR identifier, code, or UUID.',
  })
  @ApiEnvelopeResponse(
    200,
    'Public route details with ordered stations and upcoming trips.',
    PublicRouteResponseDto,
  )
  @ApiNotFound('Route not found for the provided identifier.')
  resolve(@Param('identifier') identifier: string) {
    return this.routesService.resolvePublicRoute(identifier);
  }
}
