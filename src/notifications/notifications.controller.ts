import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('passenger-notifications')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications (filter unread=true|false).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'My notifications.')
  list(
    @CurrentUser() actor: RequestUser,
    @Query() query: { cursor?: string; limit?: string; unread?: string },
  ) {
    return this.notifications.listMine(actor, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread badge count for the notification center.' })
  @ApiEnvelopeResponse(200, 'Unread count.')
  unreadCount(@CurrentUser() actor: RequestUser) {
    return this.notifications.unreadCount(actor);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read.' })
  @ApiEnvelopeResponse(200, 'All marked read.')
  markAllRead(@CurrentUser() actor: RequestUser) {
    return this.notifications.markAllRead(actor);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all my notifications.' })
  @ApiEnvelopeResponse(200, 'All deleted.')
  removeAll(@CurrentUser() actor: RequestUser) {
    return this.notifications.removeAll(actor);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read.' })
  @ApiUuidParam('id', 'Notification id.')
  @ApiEnvelopeResponse(200, 'Marked read.')
  @ApiNotFound('Notification not found.')
  markRead(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(actor, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete one notification.' })
  @ApiUuidParam('id', 'Notification id.')
  @ApiEnvelopeResponse(200, 'Deleted.')
  @ApiNotFound('Notification not found.')
  remove(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.remove(actor, id);
  }
}
