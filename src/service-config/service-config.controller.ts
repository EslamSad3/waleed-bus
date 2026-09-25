import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Platform } from '../authorization/decorators/permissions.decorator.js';
import {
  ApiAuthErrors,
  ApiEnvelopeResponse,
} from '../openapi/api-helpers.js';
import {
  ReplaceServiceConfigDto,
  ServiceConfigEntryDto,
} from './dto/service-config.dto.js';
import { ServiceConfigService } from './service-config.service.js';

@ApiTags('service-config')
@Controller('config/customer-service')
export class ServiceConfigController {
  constructor(private readonly config: ServiceConfigService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Public mobile read: active entries in order.' })
  @ApiEnvelopeResponse(200, 'Customer service entries.', ServiceConfigEntryDto, true)
  listPublic() {
    return this.config.listPublic();
  }
}

@ApiTags('platform-service-config')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('platform/config/customer-service')
export class PlatformServiceConfigController {
  constructor(private readonly config: ServiceConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Platform read: full list including inactive.' })
  @ApiEnvelopeResponse(200, 'All entries.', ServiceConfigEntryDto, true)
  listAll() {
    return this.config.listAll();
  }

  @Put()
  @ApiOperation({ summary: 'Replace the whole ordered list (client order wins).' })
  @ApiEnvelopeResponse(200, 'Entries replaced.', ServiceConfigEntryDto, true)
  replace(
    @CurrentUser() actor: RequestUser,
    @Body() dto: ReplaceServiceConfigDto,
  ) {
    return this.config.replaceAll(actor, dto);
  }
}
