import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Platform } from '../authorization/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiConflict,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { AdminBookingsService } from './admin-bookings.service.js';
import {
  AdminBookingQueryDto,
  AdminForceCancelBookingDto,
  AdminOperationalOverrideDto,
  AdminReinstateBookingDto,
} from './dto/admin-booking.dto.js';
import {
  AdminFailPaymentDto,
  AdminRefundPaymentDto,
  AdminVerifyPaymentDto,
} from './dto/admin-payment.dto.js';
import { AdminResolveReportDto } from './dto/admin-report.dto.js';
import {
  AdminBookingDetailDto,
  AdminBookingListItemDto,
  AdminBookingListResponseDto,
  AdminFailPaymentResponseDto,
  AdminForceCancelResponseDto,
  AdminOperationalOverrideResponseDto,
  AdminRefundPaymentResponseDto,
  AdminReinstateResponseDto,
  AdminResolveReportResponseDto,
  AdminVerifyPaymentResponseDto,
} from './dto/admin-booking-response.dto.js';

@ApiTags('admin-bookings')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly service: AdminBookingsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List all bookings across all fleets with multi-criteria filtering (super_admin platform path).',
  })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'Cursor page of bookings (items + nextCursor).',
    AdminBookingListResponseDto,
  )
  list(@Query() query: AdminBookingQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Inspect full single booking relational hierarchy with inline recent audit trail.',
  })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(
    200,
    'The full booking details including passenger, trip, driver, bus, reports, and audit trail.',
    AdminBookingDetailDto,
  )
  @ApiNotFound('Booking not found.')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/payment/verify')
  @ApiOperation({
    summary:
      'Verify offline/wallet payment enforcing exact-match against totalAmount.',
  })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(
    200,
    'Payment verified and marked PAID.',
    AdminVerifyPaymentResponseDto,
  )
  @ApiNotFound('Booking not found.')
  @ApiConflict('Payment already settled.')
  verifyPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @Body() dto: AdminVerifyPaymentDto,
  ) {
    return this.service.verifyPayment(id, actor.id, dto);
  }

  @Post(':id/payment/fail')
  @ApiOperation({
    summary: 'Mark an offline payment attempt as FAILED with an explanation.',
  })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(
    200,
    'Payment marked FAILED.',
    AdminFailPaymentResponseDto,
  )
  @ApiNotFound('Booking not found.')
  @ApiConflict('Cannot fail a payment that is already settled as PAID.')
  failPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @Body() dto: AdminFailPaymentDto,
  ) {
    return this.service.failPayment(id, actor.id, dto);
  }

  @Post(':id/payment/refund')
  @ApiOperation({
    summary:
      'Process a full or partial refund with cumulative balance tracking.',
  })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(
    200,
    'Refund recorded with updated balance.',
    AdminRefundPaymentResponseDto,
  )
  @ApiNotFound('Booking not found.')
  refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @Body() dto: AdminRefundPaymentDto,
  ) {
    return this.service.processRefund(id, actor.id, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Force-cancel a booking with seat inventory restoration control.',
  })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(200, 'Booking cancelled.', AdminForceCancelResponseDto)
  @ApiNotFound('Booking not found.')
  @ApiConflict('Booking is already cancelled.')
  forceCancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @Body() dto: AdminForceCancelBookingDto,
  ) {
    return this.service.forceCancel(id, actor.id, dto);
  }

  @Post(':id/reinstate')
  @ApiOperation({
    summary:
      'Reinstate a mistakenly cancelled booking with strict trip capacity validation.',
  })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(
    200,
    'Booking reinstated to CONFIRMED.',
    AdminReinstateResponseDto,
  )
  @ApiNotFound('Booking not found.')
  @ApiConflict(
    'Trip has reached full capacity (SEATS_UNAVAILABLE) or booking was not cancelled.',
  )
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @Body() dto: AdminReinstateBookingDto,
  ) {
    return this.service.reinstate(id, actor.id, dto);
  }

  @Patch(':id/operational')
  @ApiOperation({
    summary:
      'Override driver operational states (boarded, drop-off) with administrative justification.',
  })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiEnvelopeResponse(
    200,
    'Operational status updated.',
    AdminOperationalOverrideResponseDto,
  )
  @ApiNotFound('Booking not found.')
  overrideOperational(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @Body() dto: AdminOperationalOverrideDto,
  ) {
    return this.service.overrideOperational(id, actor.id, dto);
  }

  @Patch(':id/reports/:reportId')
  @ApiOperation({
    summary:
      'Resolve or dismiss a driver passenger incident report with a resolution note.',
  })
  @ApiUuidParam('id', 'Booking id (uuid).')
  @ApiUuidParam('reportId', 'Passenger report id (uuid).')
  @ApiEnvelopeResponse(
    200,
    'Incident report resolved.',
    AdminResolveReportResponseDto,
  )
  @ApiNotFound('Booking or report not found.')
  resolveReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @CurrentUser() actor: RequestUser,
    @Body() dto: AdminResolveReportDto,
  ) {
    return this.service.resolveReport(id, reportId, actor.id, dto);
  }
}
