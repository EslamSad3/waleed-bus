import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';

export type NotificationCategory =
  | 'BOOKING'
  | 'PAYMENT'
  | 'TRIP'
  | 'PROMO'
  | 'SYSTEM';

export interface NotifyInput {
  userId: string;
  category: NotificationCategory | string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  dedupeKey?: string | null;
}

/**
 * Single emit path for user inbox rows (spec 012). Server-side triggers only —
 * callers never accept a client-supplied recipient. `notify()` surfaces
 * failures; `notifyBestEffort()` swallows them so a notification can never
 * fail the originating booking/payment transaction.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly system: SystemPrismaService) {}

  private get db() {
    return this.system.notification;
  }

  async notify(input: NotifyInput) {
    try {
      return await this.db.create({
        data: {
          userId: input.userId,
          category: input.category,
          title: input.title,
          body: input.body,
          data: (input.data ?? Prisma.DbNull) as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey ?? null,
        },
      });
    } catch (err) {
      // Idempotency: same dedupeKey re-emitted → return the existing row.
      if (
        input.dedupeKey &&
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'P2002'
      ) {
        const existing = await this.db.findUnique({
          where: { dedupeKey: input.dedupeKey },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async notifyBestEffort(input: NotifyInput) {
    try {
      return await this.notify(input);
    } catch (err) {
      this.logger.warn(
        `notification dropped for user ${input.userId} (${input.category}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async requireOwned(actor: RequestUser, id: string) {
    const row = await this.db.findFirst({
      where: { id, userId: actor.id },
    });
    if (!row) {
      throw new CodedException(
        404,
        'NOTIFICATION_NOT_FOUND',
        'Notification not found.',
      );
    }
    return row;
  }

  async listMine(
    actor: RequestUser,
    query: { cursor?: string; limit?: string; unread?: string },
  ): Promise<CursorPage<unknown>> {
    const { pageSize, ...cursorArgs } = buildCursorArgs({
      cursor: query.cursor,
      limit: query.limit,
    });
    const where: Prisma.NotificationWhereInput = { userId: actor.id };
    if (query.unread === 'true') where.isRead = false;
    if (query.unread === 'false') where.isRead = true;
    const rows = await this.db.findMany({
      ...cursorArgs,
      take: pageSize + 1,
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return toCursorPage(rows, pageSize);
  }

  async unreadCount(actor: RequestUser): Promise<{ unreadCount: number }> {
    const unreadCount = await this.db.count({
      where: { userId: actor.id, isRead: false },
    });
    return { unreadCount };
  }

  async markRead(actor: RequestUser, id: string) {
    const row = await this.requireOwned(actor, id);
    if (row.isRead) return row;
    return this.db.update({
      where: { id: row.id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(actor: RequestUser): Promise<{ updated: number }> {
    const result = await this.db.updateMany({
      where: { userId: actor.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  }

  async remove(actor: RequestUser, id: string) {
    const row = await this.requireOwned(actor, id);
    await this.db.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  async removeAll(actor: RequestUser): Promise<{ deleted: number }> {
    const result = await this.db.deleteMany({
      where: { userId: actor.id },
    });
    return { deleted: result.count };
  }
}
