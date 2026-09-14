import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import {
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import { TripSharesService } from './trip-shares.service.js';
import {
  VerifiedTripShareResponseDto,
  VerifyTripShareDto,
} from './dto/trip-share.dto.js';

@ApiTags('public-shares')
@Controller('public/trip-shares')
export class PublicSharesController {
  constructor(private readonly tripSharesService: TripSharesService) {}

  @Public()
  @Post(':shareId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify a 6-digit trip share code and access read-only live tracking channel.',
  })
  @ApiUuidParam('shareId', 'Trip Share UUID')
  @ApiEnvelopeResponse(
    200,
    'Trip share verified successfully.',
    VerifiedTripShareResponseDto,
  )
  @ApiNotFound('Trip share not found.')
  verify(
    @Param('shareId', ParseUUIDPipe) shareId: string,
    @Body() dto: VerifyTripShareDto,
  ) {
    return this.tripSharesService.verifyTripShare(shareId, dto);
  }
}
