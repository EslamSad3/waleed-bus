import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Platform, RequirePermission } from '../authorization/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { ApiAuthErrors, ApiConflict, ApiEnvelopeResponse, ApiNotFound, ApiUuidParam } from '../openapi/api-helpers.js';
import { CreateStopDto, CreateTripLineDto, StationDto, UpdateDirectionalRouteStopsDto, UpdateStopDto, UpdateTripLineDto } from './dto/route.dto.js';
import { TripLinesService } from './trip-lines.service.js';

@ApiTags('trip-lines')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller()
export class TripLinesController {
  constructor(private readonly service: TripLinesService) {}

  @Get('stops')
  @RequirePermission('stations.read')
  @ApiOperation({ summary: 'List an operator fleet’s reusable stop points.' })
  findStops() { return this.service.findStops(); }

  @Post('stops')
  @RequirePermission('stations.create')
  @ApiOperation({ summary: 'Create a reusable stop point with a precise location.' })
  @ApiEnvelopeResponse(201, 'Stop created.', StationDto)
  createStop(@Body() dto: CreateStopDto, @CurrentUser() actor: RequestUser) { return this.service.createStop(dto, actor.id); }

  @Get('stops/:id')
  @RequirePermission('stations.read')
  @ApiUuidParam('id', 'Stop id.')
  @ApiNotFound('Stop not found.')
  findStop(@Param('id', ParseUUIDPipe) id: string) { return this.service.findStop(id); }

  @Patch('stops/:id')
  @RequirePermission('stations.update')
  @ApiUuidParam('id', 'Stop id.')
  updateStop(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStopDto, @CurrentUser() actor: RequestUser) { return this.service.updateStop(id, dto, actor.id); }

  @Delete('stops/:id')
  @RequirePermission('stations.delete')
  @ApiConflict('A stop used by a trip line cannot be deleted.')
  removeStop(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) { return this.service.removeStop(id, actor.id); }

  @Get('trip-lines')
  @RequirePermission('routes.read')
  @ApiOperation({ summary: 'List an operator fleet’s trip lines and their ordered stops.' })
  findTripLines() { return this.service.findTripLines(); }

  @Post('trip-lines')
  @RequirePermission('routes.create')
  @ApiOperation({ summary: 'Create a trip line from at least two ordered stop points.' })
  createTripLine(@Body() dto: CreateTripLineDto, @CurrentUser() actor: RequestUser) { return this.service.createTripLine(dto, actor.id); }

  @Get('trip-lines/:id')
  @RequirePermission('routes.read')
  findTripLine(@Param('id', ParseUUIDPipe) id: string) { return this.service.findTripLine(id); }

  @Patch('trip-lines/:id')
  @RequirePermission('routes.update')
  updateTripLine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTripLineDto, @CurrentUser() actor: RequestUser) { return this.service.updateTripLine(id, dto, actor.id); }

  @Patch('trip-lines/:id/directions/:directionId/stops')
  @RequirePermission('routes.update')
  @ApiOperation({ summary: 'Replace the ordered stops for one direction of a trip line.' })
  @ApiConflict('A direction with scheduled or historical trips cannot be changed.')
  updateDirectionStops(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('directionId', ParseUUIDPipe) directionId: string,
    @Body() dto: UpdateDirectionalRouteStopsDto,
    @CurrentUser() actor: RequestUser,
  ) { return this.service.updateDirectionStops(id, directionId, dto.stops, actor.id); }

  @Delete('trip-lines/:id')
  @RequirePermission('routes.delete')
  @ApiConflict('A trip line with trips cannot be deleted.')
  removeTripLine(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) { return this.service.removeTripLine(id, actor.id); }
}
