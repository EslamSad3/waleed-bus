import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Platform, RequirePermission } from '../authorization/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { ApiAuthErrors, ApiConflict, ApiEnvelopeResponse, ApiNotFound, ApiUuidParam } from '../openapi/api-helpers.js';
import { CreateLocalityDto, CreateMarkazDto, CreateStopDto, CreateTripLineDto, GovernorateDto, LocalityDto, MarkazDto, StationDto, UpdateDirectionalRouteStopsDto, UpdateLocalityDto, UpdateMarkazDto, UpdateStopDto, UpdateTripLineDto } from './dto/route.dto.js';
import { GeographyService } from './geography.service.js';
import { TripLinesService } from './trip-lines.service.js';

@ApiTags('trip-lines')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller()
export class TripLinesController {
  constructor(private readonly service: TripLinesService, private readonly geography: GeographyService) {}

  @Get('governorates')
  @RequirePermission('stations.read')
  @ApiOperation({ summary: 'List the built-in Egyptian governorates, localized in Arabic and English.' })
  @ApiEnvelopeResponse(200, 'Egyptian governorates.', GovernorateDto, true)
  findGovernorates() { return this.service.findGovernorates(); }

  @Get('governorates/:id/markaz')
  @RequirePermission('stations.read')
  @ApiOperation({ summary: 'List active markaz for one governorate (dependent selector).' })
  @ApiEnvelopeResponse(200, 'Active markaz of the governorate.', MarkazDto, true)
  @ApiUuidParam('id', 'Governorate id.')
  findMarkaz(@Param('id', ParseUUIDPipe) id: string) { return this.geography.listMarkaz(id); }

  @Post('markaz')
  @RequirePermission('stations.create')
  @ApiOperation({ summary: 'Create a markaz/district under one governorate.' })
  @ApiEnvelopeResponse(201, 'Markaz created.', MarkazDto)
  createMarkaz(@Body() dto: CreateMarkazDto, @CurrentUser() actor: RequestUser) { return this.geography.createMarkaz(dto, actor.id); }

  @Get('markaz/:id')
  @RequirePermission('stations.read')
  @ApiOperation({ summary: 'Get one markaz by id.' })
  @ApiEnvelopeResponse(200, 'Markaz details.', MarkazDto)
  @ApiUuidParam('id', 'Markaz id.')
  @ApiNotFound('Markaz not found.')
  findMarkazById(@Param('id', ParseUUIDPipe) id: string) { return this.geography.findMarkaz(id); }

  @Patch('markaz/:id')
  @RequirePermission('stations.update')
  @ApiOperation({ summary: 'Update a markaz (names, active flag).' })
  @ApiEnvelopeResponse(200, 'Markaz updated.', MarkazDto)
  @ApiUuidParam('id', 'Markaz id.')
  updateMarkaz(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMarkazDto, @CurrentUser() actor: RequestUser) { return this.geography.updateMarkaz(id, dto, actor.id); }

  @Get('markaz/:id/localities')
  @RequirePermission('stations.read')
  @ApiOperation({ summary: 'List active cities/villages for one markaz (dependent selector).' })
  @ApiEnvelopeResponse(200, 'Active localities of the markaz.', LocalityDto, true)
  @ApiUuidParam('id', 'Markaz id.')
  findLocalities(@Param('id', ParseUUIDPipe) id: string) { return this.geography.listLocalities(id); }

  @Post('localities')
  @RequirePermission('stations.create')
  @ApiOperation({ summary: 'Create a city/village locality under one markaz.' })
  @ApiEnvelopeResponse(201, 'Locality created.', LocalityDto)
  createLocality(@Body() dto: CreateLocalityDto, @CurrentUser() actor: RequestUser) { return this.geography.createLocality(dto, actor.id); }

  @Get('localities/:id')
  @RequirePermission('stations.read')
  @ApiOperation({ summary: 'Get one locality by id.' })
  @ApiEnvelopeResponse(200, 'Locality details.', LocalityDto)
  @ApiUuidParam('id', 'Locality id.')
  @ApiNotFound('Locality not found.')
  findLocalityById(@Param('id', ParseUUIDPipe) id: string) { return this.geography.findLocality(id); }

  @Patch('localities/:id')
  @RequirePermission('stations.update')
  @ApiOperation({ summary: 'Update a locality (names, active flag).' })
  @ApiEnvelopeResponse(200, 'Locality updated.', LocalityDto)
  @ApiUuidParam('id', 'Locality id.')
  updateLocality(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocalityDto, @CurrentUser() actor: RequestUser) { return this.geography.updateLocality(id, dto, actor.id); }

  @Get('stops')
  @RequirePermission('stations.read')
  @ApiOperation({ summary: 'List an operator fleet’s reusable stop points.' })
  @ApiEnvelopeResponse(200, 'Stop points with their governorates.', StationDto, true)
  findStops() { return this.service.findStops(); }

  @Post('stops')
  @RequirePermission('stations.create')
  @ApiOperation({ summary: 'Create a reusable stop point with a precise location.' })
  @ApiEnvelopeResponse(201, 'Stop created.', StationDto)
  createStop(@Body() dto: CreateStopDto, @CurrentUser() actor: RequestUser) { return this.service.createStop(dto, actor.id); }

  @Get('stops/:id')
  @RequirePermission('stations.read')
  @ApiOperation({ summary: 'Get one stop point by id.' })
  @ApiEnvelopeResponse(200, 'Stop details.', StationDto)
  @ApiUuidParam('id', 'Stop id.')
  @ApiNotFound('Stop not found.')
  findStop(@Param('id', ParseUUIDPipe) id: string) { return this.service.findStop(id); }

  @Patch('stops/:id')
  @RequirePermission('stations.update')
  @ApiOperation({ summary: 'Update a stop point.' })
  @ApiEnvelopeResponse(200, 'Stop updated.', StationDto)
  @ApiUuidParam('id', 'Stop id.')
  updateStop(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStopDto, @CurrentUser() actor: RequestUser) { return this.service.updateStop(id, dto, actor.id); }

  @Delete('stops/:id')
  @RequirePermission('stations.delete')
  @ApiOperation({ summary: 'Delete a stop point that is not used by any trip line.' })
  @ApiEnvelopeResponse(200, 'Stop deleted.')
  @ApiUuidParam('id', 'Stop id.')
  @ApiConflict('A stop used by a trip line cannot be deleted.')
  removeStop(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) { return this.service.removeStop(id, actor.id); }

  @Get('trip-lines')
  @RequirePermission('routes.read')
  @ApiOperation({ summary: 'List an operator fleet’s trip lines and their ordered stops.' })
  @ApiEnvelopeResponse(200, 'Trip lines with both directions and ordered stops.')
  findTripLines() { return this.service.findTripLines(); }

  @Post('trip-lines')
  @RequirePermission('routes.create')
  @ApiOperation({ summary: 'Create a trip line from at least two ordered stop points.' })
  @ApiEnvelopeResponse(201, 'Trip line created.')
  createTripLine(@Body() dto: CreateTripLineDto, @CurrentUser() actor: RequestUser) { return this.service.createTripLine(dto, actor.id); }

  @Get('trip-lines/:id')
  @RequirePermission('routes.read')
  @ApiOperation({ summary: 'Get one trip line with both directions and ordered stops.' })
  @ApiEnvelopeResponse(200, 'Trip line details.')
  @ApiUuidParam('id', 'Trip line id.')
  @ApiNotFound('Trip line not found.')
  findTripLine(@Param('id', ParseUUIDPipe) id: string) { return this.service.findTripLine(id); }

  @Patch('trip-lines/:id')
  @RequirePermission('routes.update')
  @ApiOperation({ summary: 'Rename or toggle a trip line.' })
  @ApiEnvelopeResponse(200, 'Trip line updated.')
  @ApiUuidParam('id', 'Trip line id.')
  updateTripLine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTripLineDto, @CurrentUser() actor: RequestUser) { return this.service.updateTripLine(id, dto, actor.id); }

  @Patch('trip-lines/:id/directions/:directionId/stops')
  @RequirePermission('routes.update')
  @ApiOperation({ summary: 'Replace the ordered stops for one direction of a trip line.' })
  @ApiEnvelopeResponse(200, 'Trip line with the direction’s replaced stops.')
  @ApiConflict('A direction with scheduled or historical trips cannot be changed.')
  updateDirectionStops(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('directionId', ParseUUIDPipe) directionId: string,
    @Body() dto: UpdateDirectionalRouteStopsDto,
    @CurrentUser() actor: RequestUser,
  ) { return this.service.updateDirectionStops(id, directionId, dto.stops, actor.id); }

  @Delete('trip-lines/:id')
  @RequirePermission('routes.delete')
  @ApiOperation({ summary: 'Delete a trip line that has no trips.' })
  @ApiEnvelopeResponse(200, 'Trip line deleted.')
  @ApiUuidParam('id', 'Trip line id.')
  @ApiConflict('A trip line with trips cannot be deleted.')
  removeTripLine(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) { return this.service.removeTripLine(id, actor.id); }
}
