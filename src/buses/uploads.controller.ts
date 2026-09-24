import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../authorization/decorators/permissions.decorator.js';
import { CurrentFleet } from '../common/decorators/current-fleet.decorator.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import {
  ApiAuthErrors,
  ApiEnvelopeResponse,
  ApiFleetIdParam,
  ApiNotFound,
} from '../openapi/api-helpers.js';
import { UploadsService } from './uploads.service.js';

@ApiTags('uploads')
@ApiSecurity('bearer')
@ApiAuthErrors()
@ApiFleetIdParam()
@Controller('fleets/:fleetId/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('bus-image')
  @RequirePermission('buses.update')
  @ApiOperation({
    summary:
      'Upload a bus image (JPEG/PNG/WebP, ≤5 MB) to Supabase Storage and get its public URL.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { image: { type: 'string', format: 'binary' } },
      required: ['image'],
    },
  })
  @ApiEnvelopeResponse(201, 'Public image URL.', undefined)
  @ApiNotFound('Fleet not found in this context.')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  uploadBusImage(
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @CurrentFleet() fleetContext: FleetContext,
    @Body() _body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.uploads.uploadBusImage(fleetContext.fleetId, file);
  }
}
