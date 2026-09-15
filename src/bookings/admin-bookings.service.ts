import { Injectable } from '@nestjs/common';
import type { CursorPage } from '../common/pagination.js';
import type {
  AdminBookingQueryDto,
  AdminForceCancelBookingDto,
  AdminOperationalOverrideDto,
  AdminReinstateBookingDto,
} from './dto/admin-booking.dto.js';
import type {
  AdminFailPaymentDto,
  AdminRefundPaymentDto,
  AdminVerifyPaymentDto,
} from './dto/admin-payment.dto.js';
import type { AdminResolveReportDto } from './dto/admin-report.dto.js';
import type {
  AdminBookingDetailDto,
  AdminBookingListItemDto,
  AdminFailPaymentResponseDto,
  AdminForceCancelResponseDto,
  AdminOperationalOverrideResponseDto,
  AdminRefundPaymentResponseDto,
  AdminReinstateResponseDto,
  AdminResolveReportResponseDto,
  AdminVerifyPaymentResponseDto,
} from './dto/admin-booking-response.dto.js';
import { AdminBookingsQueryService } from './admin-bookings-query.service.js';
import { AdminPaymentService } from './admin-payment.service.js';
import { AdminBookingLifecycleService } from './admin-booking-lifecycle.service.js';
import { AdminReportService } from './admin-report.service.js';

@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly queryService: AdminBookingsQueryService,
    private readonly paymentService: AdminPaymentService,
    private readonly lifecycleService: AdminBookingLifecycleService,
    private readonly reportService: AdminReportService,
  ) {}

  findAll(
    query: AdminBookingQueryDto,
  ): Promise<CursorPage<AdminBookingListItemDto>> {
    return this.queryService.findAll(query);
  }

  findOne(id: string): Promise<AdminBookingDetailDto> {
    return this.queryService.findOne(id);
  }

  verifyPayment(
    id: string,
    actorUserId: string,
    dto: AdminVerifyPaymentDto,
  ): Promise<AdminVerifyPaymentResponseDto> {
    return this.paymentService.verifyPayment(id, actorUserId, dto);
  }

  failPayment(
    id: string,
    actorUserId: string,
    dto: AdminFailPaymentDto,
  ): Promise<AdminFailPaymentResponseDto> {
    return this.paymentService.failPayment(id, actorUserId, dto);
  }

  processRefund(
    id: string,
    actorUserId: string,
    dto: AdminRefundPaymentDto,
  ): Promise<AdminRefundPaymentResponseDto> {
    return this.paymentService.processRefund(id, actorUserId, dto);
  }

  forceCancel(
    id: string,
    actorUserId: string,
    dto: AdminForceCancelBookingDto,
  ): Promise<AdminForceCancelResponseDto> {
    return this.lifecycleService.forceCancel(id, actorUserId, dto);
  }

  reinstate(
    id: string,
    actorUserId: string,
    dto: AdminReinstateBookingDto,
  ): Promise<AdminReinstateResponseDto> {
    return this.lifecycleService.reinstate(id, actorUserId, dto);
  }

  overrideOperational(
    id: string,
    actorUserId: string,
    dto: AdminOperationalOverrideDto,
  ): Promise<AdminOperationalOverrideResponseDto> {
    return this.lifecycleService.overrideOperational(id, actorUserId, dto);
  }

  resolveReport(
    bookingId: string,
    reportId: string,
    actorUserId: string,
    dto: AdminResolveReportDto,
  ): Promise<AdminResolveReportResponseDto> {
    return this.reportService.resolveReport(
      bookingId,
      reportId,
      actorUserId,
      dto,
    );
  }
}
