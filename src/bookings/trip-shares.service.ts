import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { ThrottleService } from '../passenger-auth/throttle.service.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type {
  CreateTripShareResponseDto,
  VerifiedTripShareResponseDto,
  VerifyTripShareDto,
} from './dto/trip-share.dto.js';

@Injectable()
export class TripSharesService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly throttle: ThrottleService,
  ) {}

  /**
   * Generates a 6-digit numeric verification code and share link for a confirmed booking (spec 004 US7).
   * Expires at trip.departAt + 6 hours.
   */
  async createTripShare(
    actor: RequestUser,
    bookingId: string,
  ): Promise<CreateTripShareResponseDto> {
    const booking = await this.system.booking.findUnique({
      where: { id: bookingId },
      include: {
        trip: {
          select: {
            id: true,
            status: true,
            departAt: true,
          },
        },
      },
    });

    if (!booking || booking.passengerUserId !== actor.id) {
      throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    }

    if (booking.status !== 'CONFIRMED' || booking.trip.status !== 'SCHEDULED') {
      throw new CodedException(
        409,
        'INVALID_SHARE',
        'Trip share can only be created for confirmed active trips.',
      );
    }

    const verificationCode = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(
      new Date(booking.trip.departAt).getTime() + 6 * 3600 * 1000,
    );

    const share = await this.system.tripShare.create({
      data: {
        bookingId: booking.id,
        verificationCode,
        expiresAt,
      },
    });

    return {
      shareId: share.id,
      verificationCode: share.verificationCode,
      expiresAt: share.expiresAt,
    };
  }

  /**
   * Verifies a 6-digit share code without authentication, throttled to 5 guesses per 10 minutes (spec 004 US7).
   */
  async verifyTripShare(
    shareId: string,
    input: VerifyTripShareDto,
  ): Promise<VerifiedTripShareResponseDto> {
    const budget = { limit: 5, windowMs: 10 * 60 * 1000 };
    const verdict = await this.throttle.hit(`share:verify:${shareId}`, budget);

    if (!verdict.allowed) {
      throw new CodedException(
        429,
        'SHARE_RATE_LIMITED',
        'Too many verification attempts. Please wait before retrying.',
        undefined,
        verdict.retryAfterSeconds,
      );
    }

    const share = await this.system.tripShare.findUnique({
      where: { id: shareId },
      include: {
        booking: {
          include: {
            trip: {
              include: {
                bus: {
                  select: {
                    plateNumber: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!share || share.revokedAt) {
      throw new CodedException(404, 'INVALID_SHARE', 'Trip share not found.');
    }

    const isExpired = new Date(share.expiresAt) < new Date();
    const isCompleted =
      share.booking.trip.status === 'COMPLETED' ||
      share.booking.status === 'CANCELLED';

    if (isExpired || isCompleted) {
      throw new CodedException(
        410,
        'SHARE_EXPIRED',
        'Trip share has expired or the trip is completed.',
      );
    }

    if (share.verificationCode !== input.verificationCode) {
      throw new CodedException(
        400,
        'INVALID_SHARE_CODE',
        'Incorrect verification code.',
      );
    }

    await this.system.tripShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 } },
    });

    return {
      shareId: share.id,
      passengerName: share.booking.passengerName,
      trip: {
        id: share.booking.trip.id,
        origin: share.booking.trip.origin,
        destination: share.booking.trip.destination,
        departAt: share.booking.trip.departAt,
        status: share.booking.trip.status,
        bus: {
          plateNumber: share.booking.trip.bus?.plateNumber ?? '',
        },
      },
      tracking: {
        provider: 'firebase_rtdb',
        channel: `trips/${share.booking.trip.id}`,
      },
      expiresAt: share.expiresAt,
    };
  }
}
