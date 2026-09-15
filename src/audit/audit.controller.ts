import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  Platform,
  RequirePermission,
} from '../authorization/decorators/permissions.decorator.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import {
  ApiAuthErrors,
  ApiCursorPagination,
  ApiEnvelopeResponse,
} from '../openapi/api-helpers.js';
import { AuditService } from './audit.service.js';
import { AuditLogDto } from './dto/audit-log.dto.js';

@ApiTags('audit')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  @ApiOperation({
    summary: 'Read the platform audit trail (cursor pagination, newest first).',
  })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'Cursor page of audit log rows (items + nextCursor). Secret-free by design.',
    AuditLogDto,
    true,
  )
  async list(
    @Query() query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<unknown>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const logs = await this.auditService.findMany(args);
    return toCursorPage(logs as { id: string }[], pageSize);
  }
}
