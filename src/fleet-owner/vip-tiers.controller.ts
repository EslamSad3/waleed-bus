import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Platform, RequirePermission } from '../authorization/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { ApiAuthErrors, ApiConflict, ApiEnvelopeResponse, ApiNotFound, ApiUuidParam } from '../openapi/api-helpers.js';
import { CreateVipTierDto, UpdateVipTierDto, VipTierDto } from './dto/discovery.dto.js';
import { VipTierService } from './vip-tier.service.js';

@ApiTags('vip-tiers')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('vip-tiers')
export class VipTiersController {
  constructor(private readonly tiers: VipTierService) {}

  @Get()
  @RequirePermission('fleets.read')
  @ApiOperation({ summary: 'List VIP tiers (active only unless includeInactive=true for the management screen).' })
  @ApiEnvelopeResponse(200, 'VIP tiers.', VipTierDto, true)
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.tiers.listTiers(includeInactive === 'true');
  }

  @Post()
  @RequirePermission('fleets.create')
  @ApiOperation({ summary: 'Create a VIP tier.' })
  @ApiEnvelopeResponse(201, 'Tier created.', VipTierDto)
  @ApiConflict('A tier with this name or rank already exists.')
  create(@Body() dto: CreateVipTierDto, @CurrentUser() actor: RequestUser) { return this.tiers.createTier(dto, actor.id); }

  @Get(':id')
  @RequirePermission('fleets.read')
  @ApiOperation({ summary: 'Get one VIP tier by id.' })
  @ApiEnvelopeResponse(200, 'Tier details.', VipTierDto)
  @ApiUuidParam('id', 'Tier id.')
  @ApiNotFound('Tier not found.')
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.tiers.findTier(id); }

  @Patch(':id')
  @RequirePermission('fleets.update')
  @ApiOperation({ summary: 'Update a VIP tier (name, rank, active flag).' })
  @ApiEnvelopeResponse(200, 'Tier updated.', VipTierDto)
  @ApiUuidParam('id', 'Tier id.')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVipTierDto, @CurrentUser() actor: RequestUser) { return this.tiers.updateTier(id, dto, actor.id); }
}
