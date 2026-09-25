import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
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
import { NotificationsService } from './notifications.service.js';
import {
  SendPlatformNotificationDto,
  SendPlatformNotificationResponseDto,
} from './dto/platform-notification.dto.js';

@ApiTags('platform-notifications')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('platform/notifications')
export class PlatformNotificationsController {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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
        body: true,
        tripId: true,
        promotionId: true,
        isRead: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
          },
        },
      },
    });
    return toCursorPage(rows, pageSize);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Send a notification to a single user or broadcast globally to all active users.',
  })
  @ApiEnvelopeResponse(
    201,
    'Notification dispatched.',
    SendPlatformNotificationResponseDto,
  )
  async send(
    @CurrentUser() actor: RequestUser,
    @Body() dto: SendPlatformNotificationDto,
  ) {
    return this.notifications.sendFromPlatform(dto, actor.id);
  }
}
