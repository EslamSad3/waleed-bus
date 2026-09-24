import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { NotificationsService } from '../notifications/notifications.service.js';
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
    private readonly notifications: NotificationsService,
  ) {}

  async verifyPayment(
    id: string,
    actorUserId: string,
    dto: AdminVerifyPaymentDto,
  ): Promise<AdminVerifyPaymentResponseDto> {
    return this.system.$transaction(async (tx) => {
      // Concurrency lock: serialize payment verification to prevent duplicate/conflicting updates
      const bookingRows = await tx.$queryRaw<
        Array<{
          id: string;
          paymentStatus: string;
          paymentMethod: string | null;
          paymentNotes: string | null;
          totalAmount: unknown;
          passengerUserId: string | null;
          bookedByUserId: string | null;
          bookingFor: string;
        }>
      >`
        SELECT id, payment_status as "paymentStatus", payment_method as "paymentMethod",
               payment_notes as "paymentNotes", total_amount as "totalAmount",
               passenger_user_id as "passengerUserId", booked_by_user_id as "bookedByUserId",
               booking_for as "bookingFor"
        FROM bookings
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      if (bookingRows.length === 0)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      const booking = bookingRows[0];

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
        response: {
          bookingId: updated.id,
          paymentStatus: updated.paymentStatus,
          paymentMethod: updated.paymentMethod,
          paymentReference: updated.paymentReference,
          paidAt: updated.paidAt,
          paymentMarkedBy: updated.paymentMarkedBy,
        },
        routing: {
          booker: booking.bookedByUserId ?? booking.passengerUserId,
          bookingId: id,
          total: Number(booking.totalAmount ?? 0).toFixed(2),
        },
      };
    }).then((result) => {
      // Spec 012: payment-confirmed notice to the booker (post-commit).
      if (result.routing.booker) {
        void this.notifications.notifyBestEffort({
          userId: result.routing.booker,
          category: 'PAYMENT',
          title: 'تم تأكيد الدفع',
          body: `تم تأكيد دفع الحجز ${result.routing.bookingId.slice(0, 8)} بمبلغ ${result.routing.total} جنيه.`,
          data: { bookingId: result.routing.bookingId },
          dedupeKey: `booking:${result.routing.bookingId}:paid`,
        });
      }
      return result.response;
    });
  }

  async failPayment(
    id: string,
    actorUserId: string,
    dto: AdminFailPaymentDto,
  ): Promise<AdminFailPaymentResponseDto> {
    return this.system.$transaction(async (tx) => {
      // Concurrency lock: serialize payment failure state transition
      const bookingRows = await tx.$queryRaw<
        Array<{
          id: string;
          paymentStatus: string;
        }>
      >`
        SELECT id, payment_status as "paymentStatus"
        FROM bookings
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      if (bookingRows.length === 0)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      const booking = bookingRows[0];

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
      // Concurrency lock: serialize refund operations to eliminate over-refunding races
      const bookingRows = await tx.$queryRaw<
        Array<{
          id: string;
          paymentMethod: string | null;
          paymentStatus: string;
          totalAmount: unknown;
          refundedAmount: unknown;
          passengerUserId: string | null;
          bookedByUserId: string | null;
          promoCode: string | null;
          discountAmount: unknown;
        }>
      >`
        SELECT id, payment_method as "paymentMethod", payment_status as "paymentStatus",
               total_amount as "totalAmount", refunded_amount as "refundedAmount",
               passenger_user_id as "passengerUserId", booked_by_user_id as "bookedByUserId",
               promo_code as "promoCode", discount_amount as "discountAmount"
        FROM bookings
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      if (bookingRows.length === 0)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      const booking = bookingRows[0];

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
        response: {
          bookingId: updated.id,
          paymentStatus: updated.paymentStatus,
          totalAmount: updated.totalAmount?.toString() ?? null,
          promoCode: bookingRows[0].promoCode,
          discountAmount: Number(bookingRows[0].discountAmount ?? 0).toFixed(2),
          refundedAmount: updated.refundedAmount.toString(),
          remainingRefundableBalance: (total - newRefundedTotal).toFixed(2),
          refundReference: updated.refundReference,
          updatedAt: updated.updatedAt,
        },
        routing: {
          booker: bookingRows[0].bookedByUserId ?? bookingRows[0].passengerUserId,
          bookingId: id,
          amount: Number(dto.refundAmount).toFixed(2),
        },
      };
    }).then((result) => {
      // Spec 012: refund-issued notice to the booker (post-commit).
      if (result.routing.booker) {
        void this.notifications.notifyBestEffort({
          userId: result.routing.booker,
          category: 'PAYMENT',
          title: 'تم إصدار استرداد',
          body: `تم إصدار استرداد بمبلغ ${result.routing.amount} جنيه للحجز ${result.routing.bookingId.slice(0, 8)}.`,
          data: { bookingId: result.routing.bookingId },
          dedupeKey: `booking:${result.routing.bookingId}:refund:${result.response.refundReference ?? result.response.updatedAt}`,
        });
      }
      return result.response;
    });
  }
}
