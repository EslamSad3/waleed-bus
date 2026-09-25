import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiEnvelopeResponse,
} from '../openapi/api-helpers.js';
import { ValidatePromoDto } from './dto/promotion.dto.js';
import { PromotionsService } from './promotions.service.js';

@ApiTags('passenger-promotions')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get('active')
  @ApiOperation({ summary: 'Readonly list of active global promo codes.' })
  @ApiEnvelopeResponse(200, 'Active promos.')
  listActive() {
    return this.promotions.listActivePromos();
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview a promo discount for a trip without writes.' })
  @ApiEnvelopeResponse(200, 'Promo preview.')
  validate(@CurrentUser() actor: RequestUser, @Body() dto: ValidatePromoDto) {
    return this.promotions.validatePromo(actor, dto.tripId, dto.seatCount, dto.code);
  }

  @Get()
  @ApiOperation({ summary: 'Alias for active promos (mobile convenience).' })
  @ApiEnvelopeResponse(200, 'Active promos.')
  list(@Query() _query: { cursor?: string; limit?: string }) {
    return this.promotions.listActivePromos();
  }
}
