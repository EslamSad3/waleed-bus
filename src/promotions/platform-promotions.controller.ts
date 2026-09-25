import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Platform } from '../authorization/decorators/permissions.decorator.js';
import {
  ApiAuthErrors,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import {
  CreatePromotionDto,
  PromotionDto,
  UpdatePromotionDto,
} from './dto/promotion.dto.js';
import { PromotionsService } from './promotions.service.js';

@ApiTags('platform-promotions')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('platform/promotions')
export class PlatformPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a promo code (platform).' })
  @ApiEnvelopeResponse(201, 'Promotion created.', PromotionDto)
  create(@CurrentUser() actor: RequestUser, @Body() dto: CreatePromotionDto) {
    return this.promotions.createPromotion(actor, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List promo codes with cursor pagination.' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Promotions.', PromotionDto, true)
  list(@Query() query: { cursor?: string; limit?: string }) {
    return this.promotions.listPromotions(query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a promo code (code itself is immutable).' })
  @ApiUuidParam('id', 'Promotion id.')
  @ApiEnvelopeResponse(200, 'Promotion updated.', PromotionDto)
  @ApiNotFound('Promotion not found.')
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.promotions.updatePromotion(actor, id, dto);
  }

  @Post(':id/expire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force-expire a promo code (manual lifecycle).' })
  @ApiUuidParam('id', 'Promotion id.')
  @ApiEnvelopeResponse(200, 'Promotion expired.', PromotionDto)
  @ApiNotFound('Promotion not found.')
  expire(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.promotions.expirePromotion(actor, id);
  }

  @Get(':id/usages')
  @ApiOperation({ summary: 'Per-user consumption dashboard for a code.' })
  @ApiUuidParam('id', 'Promotion id.')
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Promotion usages.')
  @ApiNotFound('Promotion not found.')
  usages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.promotions.listUsages(id, query);
  }
}
