import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { normalizePhone } from '../passenger-auth/phone.util.js';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';

export interface PassengerRatingInput {
  busRating: number;
  driverRating: number;
}

export interface PassengerRatingResponse {
  busRating: number;
  driverRating: number;
}

/**
 * Passenger self-rating (spec 003 US4). Ownership is proven by matching
 * the caller's VERIFIED phone against the booking's passengerPhone — no
 * fleet context needed, and foreign bookings 404 (no oracle). Requires a
 * COMPLETED trip; one write per side (repeat same → 200, change → 409
 * RATING_NOT_ALLOWED). The bus/driver belong to the trip by construction
 * (ratings attach to the booking's trip; summaries attribute via it).
 * Reads run on the system path (tenant RLS has no passenger context);
 * the phone match is the authorization check (OWASP BOLA: per-object).
 */
@Injectable()
export class PassengerRatingService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly system: SystemPrismaService,
  ) {}

  async rateByPassenger(
    actor: RequestUser,
    bookingId: string,
    input: PassengerRatingInput,
  ): Promise<PassengerRatingResponse> {
    const caller = await this.tenantContext.withUserContext(
      actor.id,
      async (tx) => tx.user.findUnique({ where: { id: actor.id } }),
    );
    const callerPhone = verifiedPhone(
      caller?.phoneNumber,
      caller?.phoneVerifiedAt,
    );
    if (!callerPhone) throw new NotFoundException('Booking not found');
    const row = await this.system.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { select: { status: true } } },
    });
    if (
      !row ||
      !row.passengerPhone ||
      verifiedPhone(row.passengerPhone, new Date()) !== callerPhone
    ) {
      throw new NotFoundException('Booking not found');
    }
    if (row.trip.status !== 'COMPLETED') {
      throw new CodedException(
        409,
        'RATING_NOT_ALLOWED',
        'Ratings require a COMPLETED trip.',
      );
    }
    for (const side of ['busRating', 'driverRating'] as const) {
      const stored = row[side];
      if (stored !== null && stored !== input[side]) {
        throw new CodedException(
          409,
          'RATING_NOT_ALLOWED',
          'Rating already recorded with a different value.',
        );
      }
    }
    const now = new Date();
    const updated = await this.system.booking.updateMany({
      where: { id: row.id, busRating: null, driverRating: null },
      data: {
        busRating: input.busRating,
        busRatedAt: now,
        driverRating: input.driverRating,
        driverRatedAt: now,
      },
    });
    if (updated.count === 0) {
      // Lost a race with a concurrent write, or one side was already set:
      // fill only the still-null sides so partial ratings converge.
      const current = await this.system.booking.findUniqueOrThrow({
        where: { id: row.id },
      });
      for (const side of ['busRating', 'driverRating'] as const) {
        if (current[side] !== null && current[side] !== input[side]) {
          throw new CodedException(
            409,
            'RATING_NOT_ALLOWED',
            'Rating already recorded with a different value.',
          );
        }
      }
      await this.system.booking.update({
        where: { id: row.id },
        data: {
          ...(current.busRating === null
            ? { busRating: input.busRating, busRatedAt: now }
            : {}),
          ...(current.driverRating === null
            ? { driverRating: input.driverRating, driverRatedAt: now }
            : {}),
        },
      });
    }
    return { busRating: input.busRating, driverRating: input.driverRating };
  }
}

/** Normalized phone, or null when unverified/unparseable (fail closed). */
function verifiedPhone(
  phone: string | null | undefined,
  verifiedAt: Date | null | undefined,
): string | null {
  if (!phone || !verifiedAt) return null;
  try {
    return normalizePhone(phone);
  } catch {
    return null;
  }
}
