import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CodedException } from '../common/filters/coded.exception.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import { ConfigService } from '../config/config.module.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import {
  computePromoDiscount,
  normalizePromoCode,
  promoWindowStatus,
  type PromoWindowStatus,
} from './promotion-math.js';
import type {
  CreatePromotionDto,
  UpdatePromotionDto,
} from './dto/promotion.dto.js';

export type PromoApplyStatus =
  | PromoWindowStatus
  | 'UNKNOWN'
  | 'NOT_TARGETED'
  | 'EXHAUSTED'
  | 'ALREADY_USED'
  | 'OK';

export interface PromoResolution {
  status: PromoApplyStatus;
  promotionId: string | null;
  promoCode: string | null;
  discountAmount: number;
}

type Tx = Prisma.TransactionClient;

function toDto(p: {
  id: string;
  code: string;
  type: string;
  value: { toString(): string };
  isGlobal: boolean;
  maxUsesPerUser: number;
  maxTotalUses: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
}) {
  return {
    id: p.id,
    code: p.code,
    type: p.type,
    value: p.value.toString(),
    isGlobal: p.isGlobal,
    maxUsesPerUser: p.maxUsesPerUser,
    maxTotalUses: p.maxTotalUses,
    startsAt: p.startsAt ? p.startsAt.toISOString() : null,
    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
    isActive: p.isActive,
  };
}

/**
 * Promo codes: platform CRUD + passenger validate/apply (spec 011).
 * All paths run on the system connection: promotions are platform-managed
 * catalog rows, never fleet-scoped, and passenger reads carry no oracle
 * (unknown/ineligible codes all surface as UNKNOWN).
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
    private readonly configs: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private get enforceOncePerUser(): boolean {
    return this.configs.config.promotions.enforceOncePerUser;
  }

  // ---------------------------------------------------------------- platform

  async createPromotion(actor: RequestUser, dto: CreatePromotionDto) {
    const code = normalizePromoCode(dto.code);
    if (dto.type !== 'FIXED') {
      throw new CodedException(422, 'INVALID_PROMO_VALUE', 'Promo type must be FIXED.');
    }
    if (!(dto.value > 0)) {
      throw new CodedException(422, 'INVALID_PROMO_VALUE', 'Fixed value must be a positive amount.');
    }
    if (dto.startsAt && dto.expiresAt && new Date(dto.startsAt) >= new Date(dto.expiresAt)) {
      throw new CodedException(422, 'INVALID_PROMO_WINDOW', 'startsAt must be before expiresAt.');
    }
    const isGlobal = dto.isGlobal ?? true;
    if (!isGlobal && (!dto.targetUserIds || dto.targetUserIds.length === 0)) {
      throw new CodedException(422, 'INVALID_PROMO_TARGETS', 'Non-global codes require at least one target user.');
    }
    try {
      const created = await this.system.promotion.create({
        data: {
          code,
          type: 'FIXED',
          value: dto.value,
          isGlobal,
          maxUsesPerUser: dto.maxUsesPerUser ?? 1,
          maxTotalUses: dto.maxTotalUses ?? null,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          createdByUserId: actor.id,
          ...(isGlobal
            ? {}
            : {
                targets: {
                  create: (dto.targetUserIds ?? []).map((userId) => ({ userId })),
                },
              }),
        },
      });
      await this.audit.log({
        actorUserId: actor.id,
        action: 'promotion.create',
        resource: 'promotion',
        resourceId: created.id,
        metadata: { code, type: 'FIXED' },
      });
      // Call §42: a USER-scoped code assigned to specific users emits one
      // DISCOUNT_CODE notification per target (post-commit, best-effort).
      // Global/public codes need no automatic notification.
      if (!isGlobal) {
        for (const userId of dto.targetUserIds ?? []) {
          void this.notifications.notifyBestEffort({
            userId,
            category: 'DISCOUNT_CODE',
            title: 'كود خصم جديد لك',
            body: `تم تخصيص كود الخصم ${code} لك. انسخه واستخدمه عند الحجز.`,
            promotionId: created.id,
            dedupeKey: `promo:${created.id}:assigned:${userId}`,
          });
        }
      }
      return toDto(created);
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new CodedException(409, 'PROMO_CODE_EXISTS', 'A promotion with this code already exists.');
      }
      throw err;
    }
  }

  async updatePromotion(actor: RequestUser, id: string, dto: UpdatePromotionDto) {
    const existing = await this.system.promotion.findUnique({ where: { id } });
    if (!existing) {
      throw new CodedException(404, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    }
    if (dto.value !== undefined && !(dto.value > 0)) {
      throw new CodedException(422, 'INVALID_PROMO_VALUE', 'Fixed value must be a positive amount.');
    }
    const startsAt = dto.startsAt !== undefined ? (dto.startsAt ? new Date(dto.startsAt) : null) : existing.startsAt;
    const expiresAt = dto.expiresAt !== undefined ? (dto.expiresAt ? new Date(dto.expiresAt) : null) : existing.expiresAt;
    if (startsAt && expiresAt && startsAt >= expiresAt) {
      throw new CodedException(422, 'INVALID_PROMO_WINDOW', 'startsAt must be before expiresAt.');
    }
    const updated = await this.system.$transaction(async (tx) => {
      if (dto.targetUserIds !== undefined) {
        await tx.promotionTarget.deleteMany({ where: { promotionId: id } });
        if (dto.targetUserIds.length > 0) {
          await tx.promotionTarget.createMany({
            data: dto.targetUserIds.map((userId) => ({ promotionId: id, userId })),
          });
        }
      }
      return tx.promotion.update({
        where: { id },
        data: {
          ...(dto.value !== undefined ? { value: dto.value } : {}),
          ...(dto.maxUsesPerUser !== undefined ? { maxUsesPerUser: dto.maxUsesPerUser } : {}),
          ...(dto.maxTotalUses !== undefined ? { maxTotalUses: dto.maxTotalUses } : {}),
          ...(dto.startsAt !== undefined ? { startsAt } : {}),
          ...(dto.expiresAt !== undefined ? { expiresAt } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    });
    await this.audit.log({
      actorUserId: actor.id,
      action: 'promotion.update',
      resource: 'promotion',
      resourceId: id,
      metadata: { code: existing.code },
    });
    return toDto(updated);
  }

  async expirePromotion(actor: RequestUser, id: string) {
    return this.updatePromotion(actor, id, { isActive: false });
  }

  async listPromotions(query: { cursor?: string; limit?: string }): Promise<CursorPage<unknown>> {
    const { pageSize, ...cursorArgs } = buildCursorArgs({ cursor: query.cursor, limit: query.limit });
    const rows = await this.system.promotion.findMany({
      ...cursorArgs,
      take: pageSize + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const page = toCursorPage(rows, pageSize);
    return { ...page, items: page.items.map(toDto) };
  }

  async listUsages(
    promotionId: string,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<unknown>> {
    const existing = await this.system.promotion.findUnique({ where: { id: promotionId }, select: { id: true } });
    if (!existing) {
      throw new CodedException(404, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    }
    const { pageSize, ...cursorArgs } = buildCursorArgs({ cursor: query.cursor, limit: query.limit });
    const rows = await this.system.promotionUsage.findMany({
      ...cursorArgs,
      take: pageSize + 1,
      where: { promotionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, userId: true, bookingId: true, discountAmount: true, createdAt: true },
    });
    const page = toCursorPage(rows, pageSize);
    return {
      ...page,
      items: page.items.map((r) => ({ ...r, discountAmount: r.discountAmount.toString() })),
    };
  }

  // --------------------------------------------------------------- passenger

  /** Readonly list of currently-valid GLOBAL codes (no usage internals). */
  async listActivePromos() {
    const now = new Date();
    const rows = await this.system.promotion.findMany({
      where: {
        isActive: true,
        isGlobal: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        code: true,
        type: true,
        value: true,
        expiresAt: true,
      },
    });
    return rows.map((r) => ({
      code: r.code,
      type: r.type,
      value: r.value.toString(),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    }));
  }

  /**
   * Dry-run preview: discount for a trip/seatCount without writes. Unknown or
   * ineligible codes surface as UNKNOWN (no oracle); only exhausted/reused
   * codes raise — mirroring checkout semantics.
   */
  async validatePromo(actor: RequestUser, tripId: string, seatCount: number, rawCode: string) {
    const gross = await this.tripGross(tripId, seatCount);
    const resolution = await this.system.$transaction((tx) =>
      this.resolveInTx(tx, rawCode, actor.id, gross, false),
    );
    return {
      promoCode: resolution.promoCode,
      promoStatus: resolution.status,
      discountAmount: resolution.discountAmount.toFixed(2),
      payableAmount: (gross - resolution.discountAmount).toFixed(2),
    };
  }

  private async tripGross(tripId: string, seatCount: number): Promise<number> {
    const trip = await this.system.trip.findUnique({
      where: { id: tripId },
      select: { fare: true, status: true },
    });
    if (!trip) {
      throw new CodedException(404, 'TRIP_NOT_FOUND', 'Trip not found.');
    }
    return Number(trip.fare) * seatCount;
  }

  /**
   * Checkout-time resolution inside the booking transaction. The promotion row
   * is locked FOR UPDATE so concurrent checkouts serialize per code (total
   * caps hold under race). Soft failures (unknown/inactive/window) resolve to
   * full price; hard failures (exhausted/reused) throw.
   */
  async resolveInTx(
    tx: Tx,
    rawCode: string,
    userId: string,
    gross: number,
    forWrite: boolean,
  ): Promise<PromoResolution> {
    const none = (status: PromoApplyStatus): PromoResolution => ({
      status,
      promotionId: null,
      promoCode: null,
      discountAmount: 0,
    });
    let code: string;
    try {
      code = normalizePromoCode(rawCode);
    } catch {
      return none('UNKNOWN');
    }
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        code: string;
        type: string;
        value: unknown;
        is_global: boolean;
        max_uses_per_user: number;
        max_total_uses: number | null;
        starts_at: Date | null;
        expires_at: Date | null;
        is_active: boolean;
      }>
    >`SELECT id, code, type, value, is_global, max_uses_per_user, max_total_uses, starts_at, expires_at, is_active FROM promotions WHERE code = ${code} FOR UPDATE`;
    if (locked.length === 0) return none('UNKNOWN');
    const promo = locked[0];

    const window = promoWindowStatus(
      { isActive: promo.is_active, startsAt: promo.starts_at, expiresAt: promo.expires_at },
      new Date(),
    );
    if (window !== 'OK') return none(window);

    if (!promo.is_global) {
      const targeted = await tx.promotionTarget.findUnique({
        where: { promotionId_userId: { promotionId: promo.id, userId } },
        select: { promotionId: true },
      });
      if (!targeted) return none('NOT_TARGETED');
    }

    if (promo.max_total_uses != null) {
      const used = await tx.promotionUsage.count({
        where: { promotionId: promo.id },
      });
      if (used >= promo.max_total_uses) {
        throw new CodedException(422, 'PROMO_EXHAUSTED', 'This promo code has reached its usage limit.');
      }
    }

    if (this.enforceOncePerUser) {
      const mine = await tx.promotionUsage.count({
        where: { promotionId: promo.id, userId },
      });
      if (mine >= promo.max_uses_per_user) {
        throw new CodedException(422, 'PROMO_ALREADY_USED', 'You have already used this promo code.');
      }
    }

    const discountAmount = computePromoDiscount({
      type: promo.type,
      value: promo.value as number,
      gross,
    });
    void forWrite;
    return { status: 'OK', promotionId: promo.id, promoCode: promo.code, discountAmount };
  }

  async recordUsage(
    tx: Tx,
    args: { promotionId: string; userId: string; bookingId: string; discountAmount: number },
  ) {
    await tx.promotionUsage.create({
      data: {
        promotionId: args.promotionId,
        userId: args.userId,
        bookingId: args.bookingId,
        discountAmount: args.discountAmount,
      },
    });
  }
}
