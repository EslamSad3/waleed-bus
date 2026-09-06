import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator.js';

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
