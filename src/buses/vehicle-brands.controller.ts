import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Platform, RequirePermission } from '../authorization/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { ApiAuthErrors, ApiConflict, ApiEnvelopeResponse, ApiNotFound, ApiUuidParam } from '../openapi/api-helpers.js';
import { CreateVehicleBrandDto, UpdateVehicleBrandDto, VehicleBrandDto } from './dto/bus.dto.js';
import { VehicleBrandService } from './vehicle-brand.service.js';

@ApiTags('vehicle-brands')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('brands')
export class VehicleBrandsController {
  constructor(private readonly brands: VehicleBrandService) {}

  @Get()
  @RequirePermission('buses.read')
  @ApiOperation({ summary: 'List active vehicle brands ordered for selection.' })
  @ApiEnvelopeResponse(200, 'Active vehicle brands.', VehicleBrandDto, true)
  findAll() { return this.brands.listBrands(); }

  @Post()
  @RequirePermission('buses.create')
  @ApiOperation({ summary: 'Create a vehicle brand.' })
  @ApiEnvelopeResponse(201, 'Brand created.', VehicleBrandDto)
  @ApiConflict('A brand with this name already exists.')
  create(@Body() dto: CreateVehicleBrandDto, @CurrentUser() actor: RequestUser) { return this.brands.createBrand(dto, actor.id); }

  @Get(':id')
  @RequirePermission('buses.read')
  @ApiOperation({ summary: 'Get one vehicle brand by id.' })
  @ApiEnvelopeResponse(200, 'Brand details.', VehicleBrandDto)
  @ApiUuidParam('id', 'Brand id.')
  @ApiNotFound('Brand not found.')
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.brands.findBrand(id); }

  @Patch(':id')
  @RequirePermission('buses.update')
  @ApiOperation({ summary: 'Update a vehicle brand (name, order, active flag).' })
  @ApiEnvelopeResponse(200, 'Brand updated.', VehicleBrandDto)
  @ApiUuidParam('id', 'Brand id.')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVehicleBrandDto, @CurrentUser() actor: RequestUser) { return this.brands.updateBrand(id, dto, actor.id); }
}
