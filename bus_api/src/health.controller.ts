import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator.js';
import { API_VERSION } from './openapi/openapi.document.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe.' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy.',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'integer', example: 200 },
        data: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } },
      },
    },
  })
  health(): { status: string } {
    return { status: 'ok' };
  }
}

/** Landing endpoint (GET /): identifies the service and its main surfaces. */
@ApiTags('health')
@Controller()
export class RootController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Service information.' })
  @ApiResponse({
    status: 200,
    description: 'Service name, contract version, and entrypoint paths.',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'integer', example: 200 },
        data: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Bus Fleet API' },
            version: { type: 'string', example: API_VERSION },
            docs: { type: 'string', example: '/docs' },
            health: { type: 'string', example: '/health' },
          },
        },
      },
    },
  })
  serviceInfo(): { name: string; version: string; docs: string; health: string } {
    return { name: 'Bus Fleet API', version: API_VERSION, docs: '/docs', health: '/health' };
  }
}
