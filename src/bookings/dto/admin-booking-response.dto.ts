import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminBookingListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fleetId!: string;

  @ApiProperty({ example: 'Al-Waleed Express' })
  fleetName!: string;

  @ApiProperty({ format: 'uuid' })
  tripId!: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  passengerName!: string;

  @ApiPropertyOptional({ type: String, example: '+201000000000', nullable: true })
  passengerPhone!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  passengerUserId!: string | null;

  @ApiProperty({ enum: ['SELF', 'OTHER'], example: 'SELF' })
  bookingFor!: string;

  @ApiPropertyOptional({ type: String, example: 'Wait near the bridge.', nullable: true })
  note!: string | null;

  @ApiProperty({ example: 2 })
  seats!: number;

  @ApiProperty({ example: 'CONFIRMED' })
  status!: string;

  @ApiPropertyOptional({ type: String, example: '100.00', nullable: true })
  totalAmount!: string | null;

  @ApiProperty({ example: '0.00' })
  refundedAmount!: string;

  @ApiPropertyOptional({ type: String, example: 'CASH', nullable: true })
  paymentMethod!: string | null;

  @ApiPropertyOptional({ type: String, example: 'PAID', nullable: true })
  paymentStatus!: string | null;

  @ApiPropertyOptional({ type: String, example: 'REF-12345', nullable: true })
  paymentReference!: string | null;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  boardedAt!: Date | null;

  @ApiPropertyOptional({ type: String, example: 'DROPPED_OFF', nullable: true })
  dropStatus!: string | null;

  @ApiProperty({ example: false })
  hasReports!: boolean;

  @ApiProperty({ format: 'date-time' })
  tripDepartureTime!: Date;

  @ApiProperty({ example: 'Cairo' })
  originName!: string;

  @ApiProperty({ example: 'Alexandria' })
  destinationName!: string;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  confirmedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class AdminBookingListResponseDto {
  @ApiProperty({ type: () => [AdminBookingListItemDto] })
  items!: AdminBookingListItemDto[];

  @ApiPropertyOptional({ type: String, example: 'eyJpZCI6IjEyMyJ9', nullable: true })
  nextCursor!: string | null;
}

export class AdminBookingAuditTrailItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'booking.verify_payment' })
  action!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  actorUserId!: string | null;

  @ApiPropertyOptional()
  metadata!: unknown;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class AdminBookingDetailTripDriverDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ type: String, example: 'Mohamed Ibrahim', nullable: true })
  name!: string | null;

  @ApiPropertyOptional({ type: String, example: '+201100000000', nullable: true })
  phoneNumber!: string | null;
}

export class AdminBookingDetailTripBusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ type: String, example: 'BUS-001', nullable: true })
  registrationNumber!: string | null;

  @ApiProperty({ example: 14 })
  capacity!: number;
}

export class AdminBookingDetailTripDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  departureTime!: Date;

  @ApiProperty({ example: 'Cairo' })
  originName!: string;

  @ApiProperty({ example: 'Alexandria' })
  destinationName!: string;

  @ApiProperty({ example: '50.00' })
  fare!: string;

  @ApiProperty({ example: 'SCHEDULED' })
  status!: string;

  @ApiProperty({ example: 12 })
  availableSeats!: number;

  @ApiProperty({ type: () => AdminBookingDetailTripBusDto })
  bus!: AdminBookingDetailTripBusDto;

  @ApiPropertyOptional({ type: () => AdminBookingDetailTripDriverDto, nullable: true })
  driver!: AdminBookingDetailTripDriverDto | null;

  @ApiPropertyOptional()
  route?: unknown;
}

export class AdminBookingRatingsDto {
  @ApiPropertyOptional({ type: Number, example: 5, nullable: true })
  busRating!: number | null;

  @ApiPropertyOptional({ type: Number, example: 5, nullable: true })
  driverRating!: number | null;

  @ApiPropertyOptional({ type: Number, example: 5, nullable: true })
  passengerRating!: number | null;
}

export class AdminBookingDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fleetId!: string;

  @ApiProperty({ example: 'Al-Waleed Express' })
  fleetName!: string;

  @ApiProperty({ example: 'CONFIRMED' })
  status!: string;

  @ApiProperty({ example: 2 })
  seats!: number;

  @ApiProperty({ example: 'Ahmed Hassan' })
  passengerName!: string;

  @ApiPropertyOptional({ type: String, example: '+201000000000', nullable: true })
  passengerPhone!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  passengerUserId!: string | null;

  @ApiProperty({ enum: ['SELF', 'OTHER'], example: 'SELF' })
  bookingFor!: string;

  @ApiPropertyOptional({ type: String, example: 'Wait near the bridge.', nullable: true })
  note!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  boardingStationId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  landingStationId!: string | null;

  @ApiPropertyOptional({ type: String, example: 'محطة رمسيس', nullable: true })
  boardingStationName?: string | null;

  @ApiPropertyOptional({ type: String, example: 'محطة سيدي جابر', nullable: true })
  landingStationName?: string | null;

  @ApiPropertyOptional({ type: String, example: '100.00', nullable: true })
  totalAmount!: string | null;

  @ApiPropertyOptional({ type: String, example: 'SAVE10', nullable: true })
  promoCode!: string | null;

  @ApiProperty({ example: '10.00' })
  discountAmount!: string;

  @ApiProperty({ example: '0.00' })
  refundedAmount!: string;

  @ApiPropertyOptional({ type: String, example: 'CASH', nullable: true })
  paymentMethod!: string | null;

  @ApiPropertyOptional({ type: String, example: 'PAID', nullable: true })
  paymentStatus!: string | null;

  @ApiPropertyOptional({ type: String, example: 'REF-12345', nullable: true })
  paymentReference!: string | null;

  @ApiPropertyOptional({ type: String, example: 'Customer paid at station', nullable: true })
  paymentNotes!: string | null;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  paidAt!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  paymentMarkedBy!: string | null;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  confirmedAt!: Date | null;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  cancelledBy!: string | null;

  @ApiPropertyOptional({ type: String, example: 'Customer cancelled', nullable: true })
  cancellationReason!: string | null;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  boardedAt!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  boardedBy!: string | null;

  @ApiPropertyOptional({ type: String, example: 'DROPPED_OFF', nullable: true })
  dropStatus!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  dropStationId!: string | null;

  @ApiPropertyOptional({ type: String, example: 'Scheduled stop', nullable: true })
  dropReason!: string | null;

  @ApiPropertyOptional()
  passenger?: unknown;

  @ApiProperty({ type: () => AdminBookingDetailTripDto })
  trip!: AdminBookingDetailTripDto;

  @ApiPropertyOptional({ isArray: true })
  reports!: unknown[];

  @ApiProperty({ type: () => AdminBookingRatingsDto })
  ratings!: AdminBookingRatingsDto;

  @ApiProperty({ type: () => [AdminBookingAuditTrailItemDto] })
  auditTrail!: AdminBookingAuditTrailItemDto[];
}

export class AdminVerifyPaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  bookingId!: string;

  @ApiPropertyOptional({ type: String, example: 'PAID', nullable: true })
  paymentStatus!: string | null;

  @ApiPropertyOptional({ type: String, example: 'CASH', nullable: true })
  paymentMethod!: string | null;

  @ApiPropertyOptional({ type: String, example: 'REF-12345', nullable: true })
  paymentReference!: string | null;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  paidAt!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  paymentMarkedBy!: string | null;
}

export class AdminFailPaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  bookingId!: string;

  @ApiPropertyOptional({ type: String, example: 'FAILED', nullable: true })
  paymentStatus!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class AdminRefundPaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  bookingId!: string;

  @ApiPropertyOptional({ type: String, example: 'REFUNDED', nullable: true })
  paymentStatus!: string | null;

  @ApiPropertyOptional({ type: String, example: '100.00', nullable: true })
  totalAmount!: string | null;

  @ApiPropertyOptional({ type: String, example: 'SAVE10', nullable: true })
  promoCode!: string | null;

  @ApiProperty({ example: '10.00' })
  discountAmount!: string;

  @ApiProperty({ example: '0.00' })
  refundedAmount!: string;

  @ApiProperty({ example: '0.00' })
  remainingRefundableBalance!: string;

  @ApiPropertyOptional({ type: String, example: 'REFUND-12345', nullable: true })
  refundReference!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class AdminForceCancelResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CANCELLED' })
  status!: string;

  @ApiPropertyOptional({ type: String, example: 'Administrative cancellation', nullable: true })
  cancellationReason!: string | null;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;

  @ApiPropertyOptional({ type: String, example: 'REFUND_PENDING', nullable: true })
  paymentStatus!: string | null;

  @ApiProperty({ example: true })
  seatsRestored!: boolean;
}

export class AdminReinstateResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CONFIRMED' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  reinstatedAt!: Date;
}

export class AdminOperationalOverrideResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  boardedAt!: Date | null;

  @ApiPropertyOptional({ type: String, example: 'DROPPED_OFF', nullable: true })
  dropStatus!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  dropStationId!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class AdminResolveReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  bookingId!: string;

  @ApiProperty({ format: 'uuid' })
  driverId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  passengerId!: string | null;

  @ApiProperty({ example: 'Luggage issue resolved' })
  driverNote!: string;

  @ApiProperty({ example: 'RESOLVED' })
  status!: string;

  @ApiPropertyOptional({ type: String, example: 'Investigated and resolved with passenger', nullable: true })
  resolutionNote!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  resolvedBy!: string | null;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  resolvedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
