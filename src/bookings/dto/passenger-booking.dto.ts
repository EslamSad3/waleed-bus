import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export const PASSENGER_PAYMENT_METHODS = [
  'CASH',
  'VODAFONE_CASH',
  'ORANGE_MONEY',
  'ETISALAT_CASH',
  'WE_PAY',
  'CARD',
] as const;

export const BOOKING_STATUS_FILTER = ['CONFIRMED', 'CANCELLED'] as const;
export const TIME_FILTER = ['upcoming', 'past'] as const;

export class CreatePassengerBookingDto {
  @ApiProperty({ format: 'uuid', description: 'Target scheduled trip' })
  @IsUUID()
  tripId!: string;

  @ApiProperty({
    example: 2,
    minimum: 1,
    description: 'Number of seats to reserve',
  })
  @IsInt()
  @Min(1)
  seatCount!: number;

  @ApiProperty({
    enum: [...PASSENGER_PAYMENT_METHODS],
    example: 'CASH',
    description: 'Payment method for this reservation',
  })
  @IsString()
  @IsIn([...PASSENGER_PAYMENT_METHODS])
  paymentMethod!: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'Set to true to override a DUPLICATE_TIME_BOOKING conflict',
  })
  @IsOptional()
  @IsBoolean()
  confirmTimeConflict?: boolean;
}

export class CancelPassengerBookingDto {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description:
      'Number of seats to cancel. If omitted, all seats are cancelled.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  seatsToCancel?: number;

  @ApiPropertyOptional({
    example: 'Change of plans',
    maxLength: 500,
    description: 'Optional cancellation reason',
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}

export class PassengerBookingListQueryDto {
  @ApiPropertyOptional({
    enum: [...BOOKING_STATUS_FILTER],
    description: 'Filter by booking status',
  })
  @IsOptional()
  @IsIn([...BOOKING_STATUS_FILTER])
  status?: string;

  @ApiPropertyOptional({
    enum: [...TIME_FILTER],
    description: 'Filter by upcoming or past trips',
  })
  @IsOptional()
  @IsIn([...TIME_FILTER])
  timeFilter?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Cursor pagination token',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class BookingBusSummaryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  id?: string;

  @ApiPropertyOptional({ example: 'ق ب أ 1234' })
  plateNumber?: string | null;

  @ApiPropertyOptional({ example: 'BUS-001' })
  registrationNumber?: string | null;
}

export class BookingTripSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Cairo' })
  origin!: string;

  @ApiProperty({ example: 'Alexandria' })
  destination!: string;

  @ApiProperty({ example: '2026-09-15T08:00:00.000Z', format: 'date-time' })
  departAt!: Date;

  @ApiProperty({ example: 'SCHEDULED' })
  status!: string;

  @ApiPropertyOptional({ type: () => BookingBusSummaryDto })
  bus?: BookingBusSummaryDto | null;
}

export class PassengerBookingItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tripId!: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  passengerName!: string;

  @ApiPropertyOptional({ example: '01000000000' })
  passengerPhone?: string | null;

  @ApiProperty({ example: 2 })
  seats!: number;

  @ApiProperty({ example: 'CONFIRMED' })
  status!: string;

  @ApiPropertyOptional({ example: 'CASH' })
  paymentMethod?: string | null;

  @ApiPropertyOptional({ example: 'PENDING' })
  paymentStatus?: string | null;

  @ApiPropertyOptional({ example: '100.00' })
  totalAmount?: string | null;

  @ApiProperty({ format: 'date-time' })
  confirmedAt!: Date;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  boardedAt?: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  droppedAt?: Date | null;

  @ApiPropertyOptional({ example: 5, nullable: true })
  busRating?: number | null;

  @ApiPropertyOptional({ example: 5, nullable: true })
  driverRating?: number | null;

  @ApiProperty({ type: () => BookingTripSummaryDto })
  trip!: BookingTripSummaryDto;
}

export class PassengerBookingDetailDto extends PassengerBookingItemDto {}

export class CancelledBookingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CONFIRMED' })
  status!: string;

  @ApiProperty({ example: 1 })
  seats!: number;

  @ApiProperty({ example: 1 })
  cancelledSeats!: number;

  @ApiProperty({ example: 'REFUND_PENDING' })
  paymentStatus!: string;

  @ApiProperty({ format: 'date-time' })
  cancelledAt!: Date;

  @ApiPropertyOptional({ example: 'Change of plans', nullable: true })
  cancellationReason?: string | null;
}

export class ActiveTripDriverDto {
  @ApiPropertyOptional({ example: 'Mohamed Ibrahim', nullable: true })
  name?: string | null;

  @ApiPropertyOptional({ example: '01100000000', nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  picture?: string | null;
}

export class ActiveTripBusDto {
  @ApiPropertyOptional({ example: 'ق ب أ 1234', nullable: true })
  plateNumber?: string | null;

  @ApiProperty({ example: 14 })
  capacity!: number;
}

export class ActiveTripTrackingDto {
  @ApiProperty({ example: 'firebase_rtdb' })
  provider!: string;

  @ApiProperty({ example: 'trips/7f000001-91ea-13b2-8191-ea1c00000001' })
  channel!: string;
}

export class ActiveTripDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Cairo' })
  origin!: string;

  @ApiProperty({ example: 'Alexandria' })
  destination!: string;

  @ApiProperty({ format: 'date-time' })
  departAt!: Date;

  @ApiProperty({ example: 'SCHEDULED' })
  status!: string;

  @ApiProperty({ type: () => ActiveTripBusDto })
  bus!: ActiveTripBusDto;

  @ApiPropertyOptional({ type: () => ActiveTripDriverDto, nullable: true })
  driver?: ActiveTripDriverDto | null;
}

export class ActivePassengerTripDto {
  @ApiProperty({ format: 'uuid' })
  bookingId!: string;

  @ApiProperty({ example: 2 })
  seats!: number;

  @ApiProperty({
    example: 'NOT_BOARDED',
    enum: ['NOT_BOARDED', 'BOARDED', 'DROPPED'],
  })
  boardingStatus!: string;

  @ApiProperty({ type: () => ActiveTripDetailDto })
  trip!: ActiveTripDetailDto;

  @ApiProperty({ type: () => ActiveTripTrackingDto })
  tracking!: ActiveTripTrackingDto;
}
