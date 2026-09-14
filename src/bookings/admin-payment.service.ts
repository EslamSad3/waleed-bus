import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type {
  AdminFailPaymentDto,
  AdminRefundPaymentDto,
  AdminVerifyPaymentDto,
} from './dto/admin-payment.dto.js';
import type {
  AdminFailPaymentResponseDto,
  AdminRefundPaymentResponseDto,
  AdminVerifyPaymentResponseDto,
} from './dto/admin-booking-response.dto.js';

@Injectable()
export class AdminPaymentService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async verifyPayment(
    id: string,
    actorUserId: string,
    dto: AdminVerifyPaymentDto,
  ): Promise<AdminVerifyPaymentResponseDto> {
    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');

      if (
        booking.paymentStatus === 'PAID' ||
        booking.paymentStatus === 'REFUNDED'
      ) {
        throw new CodedException(
          409,
          'PAYMENT_ALREADY_SETTLED',
          'Payment is already settled',
        );
      }

      const total = Number(booking.totalAmount ?? 0);
      if (Math.abs(Number(dto.amount) - total) > 0.001) {
        throw new CodedException(
          400,
          'PAYMENT_AMOUNT_MISMATCH',
          'Payment amount does not match booking total amount',
        );
      }

      const now = new Date();
      const updated = await tx.booking.update({
        where: { id },
        data: {
          paymentStatus: 'PAID',
          paymentMethod: dto.paymentMethod ?? booking.paymentMethod,
          paymentReference: dto.reference,
          paymentNotes: dto.notes ?? booking.paymentNotes,
          paidAt: now,
          paymentMarkedBy: actorUserId,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'booking.verify_payment',
        resource: 'bookings',
        resourceId: id,
        metadata: {
          previousStatus: booking.paymentStatus,
          newStatus: 'PAID',
          reference: dto.reference,
          amount: dto.amount,
        },
      });

      return {
        bookingId: updated.id,
        paymentStatus: updated.paymentStatus,
        paymentMethod: updated.paymentMethod,
        paymentReference: updated.paymentReference,
        paidAt: updated.paidAt,
        paymentMarkedBy: updated.paymentMarkedBy,
      };
    });
  }

  async failPayment(
    id: string,
    actorUserId: string,
    dto: AdminFailPaymentDto,
  ): Promise<AdminFailPaymentResponseDto> {
    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');

      if (booking.paymentStatus === 'PAID') {
        throw new CodedException(
          409,
          'PAYMENT_ALREADY_SETTLED',
          'Cannot mark a settled PAID payment as failed; process refund instead',
        );
      }

      const updated = await tx.booking.update({
        where: { id },
        data: {
          paymentStatus: 'FAILED',
          paymentNotes: dto.notes
            ? `${dto.reason} | Note: ${dto.notes}`
            : dto.reason,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'booking.fail_payment',
        resource: 'bookings',
        resourceId: id,
        metadata: {
          previousStatus: booking.paymentStatus,
          newStatus: 'FAILED',
          reason: dto.reason,
        },
      });

      return {
        bookingId: updated.id,
        paymentStatus: updated.paymentStatus,
        updatedAt: updated.updatedAt,
      };
    });
  }

  async processRefund(
    id: string,
    actorUserId: string,
    dto: AdminRefundPaymentDto,
  ): Promise<AdminRefundPaymentResponseDto> {
    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');

      if (
        booking.paymentMethod === 'CASH' &&
        booking.paymentStatus !== 'PAID'
      ) {
        throw new CodedException(
          400,
          'REFUND_NOT_ELIGIBLE',
          'Cash bookings without collected payment are not eligible for electronic refund',
        );
      }

      const total = Number(booking.totalAmount ?? 0);
      const previouslyRefunded = Number(booking.refundedAmount ?? 0);
      const remainingBalance = total - previouslyRefunded;

      if (Number(dto.refundAmount) > remainingBalance + 0.001) {
        throw new CodedException(
          400,
          'REFUND_EXCEEDS_BALANCE',
          'Refund amount exceeds remaining refundable balance',
        );
      }

      const newRefundedTotal = previouslyRefunded + Number(dto.refundAmount);
      const isFullyRefunded = Math.abs(newRefundedTotal - total) <= 0.001;
      const newStatus = isFullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      const updated = await tx.booking.update({
        where: { id },
        data: {
          paymentStatus: newStatus,
          refundedAmount: newRefundedTotal,
          refundReference: dto.refundReference,
          paymentNotes: dto.notes ? `${dto.reason} | ${dto.notes}` : dto.reason,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'booking.refund',
        resource: 'bookings',
        resourceId: id,
        metadata: {
          refundReference: dto.refundReference,
          refundAmount: dto.refundAmount,
          newRefundedTotal,
          previousStatus: booking.paymentStatus,
          newStatus,
          reason: dto.reason,
        },
      });

      return {
        bookingId: updated.id,
        paymentStatus: updated.paymentStatus,
        totalAmount: updated.totalAmount?.toString() ?? null,
        refundedAmount: updated.refundedAmount.toString(),
        remainingRefundableBalance: (total - newRefundedTotal).toFixed(2),
        refundReference: updated.refundReference,
        updatedAt: updated.updatedAt,
      };
    });
  }
}
