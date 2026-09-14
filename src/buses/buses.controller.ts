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
import {
  RequireAnyPermission,
  RequirePermission,
} from '../authorization/decorators/permissions.decorator.js';
import { CurrentFleet } from '../common/decorators/current-fleet.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiConflict,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiFleetIdParam,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { BusesService } from './buses.service.js';
import { BusDto, CreateBusDto, UpdateBusDto } from './dto/bus.dto.js';

@ApiTags('buses')
@ApiSecurity('bearer')
@ApiAuthErrors()
@ApiFleetIdParam()
@Controller('fleets/:fleetId/buses')
export class BusesController {
  constructor(private readonly busesService: BusesService) {}

  @Post()
  @RequirePermission('buses.create')
  @ApiOperation({ summary: 'Register a bus in the fleet.' })
  @ApiEnvelopeResponse(
    201,
    'Bus created. The fleetId always comes from the verified context, never from the body.',
    BusDto,
  )
  @ApiConflict('registrationNumber already exists in this fleet.')
  create(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Body() dto: CreateBusDto,
  ) {
    return this.busesService.create(actor, fleetContext, dto);
  }

  @Get()
  @RequireAnyPermission('buses.read', 'buses.create')
  @ApiOperation({ summary: 'List the fleet buses (cursor pagination).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'Cursor page of buses (items + nextCursor).',
    BusDto,
    true,
  )
  list(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.busesService.findAll(actor, fleetContext, query);
  }

  @Get(':id')
  @RequirePermission('buses.read')
  @ApiOperation({ summary: 'Fetch one bus.' })
  @ApiUuidParam('id', 'Bus id (uuid).')
  @ApiEnvelopeResponse(200, 'The bus.', BusDto)
  @ApiNotFound('Bus not found in this fleet (cross-fleet ids are also 404).')
  findOne(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.busesService.findOne(actor, fleetContext, id);
  }

  @Patch(':id')
  @RequirePermission('buses.update')
  @ApiOperation({ summary: 'Update a bus.' })
  @ApiUuidParam('id', 'Bus id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated bus.', BusDto)
  @ApiNotFound('Bus not found in this fleet (cross-fleet ids are also 404).')
  @ApiConflict('registrationNumber already exists in this fleet.')
  update(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBusDto,
  ) {
    return this.busesService.update(actor, fleetContext, id, dto);
  }

  @Delete(':id')
  @RequirePermission('buses.delete')
  @ApiOperation({ summary: 'Delete a bus.' })
  @ApiUuidParam('id', 'Bus id (uuid).')
  @ApiEnvelopeResponse(200, 'Bus deleted; data is null.')
  @ApiNotFound('Bus not found in this fleet (cross-fleet ids are also 404).')
  remove(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.busesService.remove(actor, fleetContext, id);
  }
}
