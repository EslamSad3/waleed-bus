import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  ApiAuthErrors,
  ApiCursorPagination,
  ApiEnvelopeResponse,
} from '../openapi/api-helpers.js';
import { Platform } from '../authorization/decorators/permissions.decorator.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import {
  buildCursorArgs,
  toCursorPage,
} from '../common/pagination.js';

@ApiTags('platform-notifications')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('platform/notifications')
export class PlatformNotificationsController {
  constructor(private readonly system: SystemPrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Ops visibility into recent notifications (filter by userId/category).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'Notifications.')
  async list(
    @Query() query: { cursor?: string; limit?: string; userId?: string; category?: string },
  ) {
    const { pageSize, ...cursorArgs } = buildCursorArgs({ cursor: query.cursor, limit: query.limit });
    const rows = await this.system.notification.findMany({
      ...cursorArgs,
      take: pageSize + 1,
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.category ? { category: query.category } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        category: true,
        title: true,
        tripId: true,
        promotionId: true,
        isRead: true,
        createdAt: true,
      },
    });
    return toCursorPage(rows, pageSize);
  }
}
