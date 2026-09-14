import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const ADMIN_BOOKING_STATUSES = [
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
] as const;
export const ADMIN_PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
  'CANCELLED',
] as const;
export const ADMIN_DROP_STATUSES = ['DROPPED_OFF', 'NOT_DROPPED_OFF'] as const;

export class AdminBookingQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (opaque token).' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 100,
    description: 'Page limit.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by fleet id.' })
  @IsOptional()
  @IsUUID()
  fleetId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by trip id.' })
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by passenger user id.',
  })
  @IsOptional()
  @IsUUID()
  passengerUserId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by passenger phone number (case-insensitive substring).',
  })
  @IsOptional()
  @IsString()
  passengerPhone?: string;

  @ApiPropertyOptional({
    description: 'Filter by passenger name (case-insensitive substring).',
  })
  @IsOptional()
  @IsString()
  passengerName?: string;

  @ApiPropertyOptional({
    enum: [...ADMIN_BOOKING_STATUSES],
    description: 'Filter by booking status.',
  })
  @IsOptional()
  @IsString()
  @IsIn([...ADMIN_BOOKING_STATUSES])
  status?: string;

  @ApiPropertyOptional({
    enum: [...ADMIN_PAYMENT_STATUSES],
    description: 'Filter by payment status.',
  })
  @IsOptional()
  @IsString()
  @IsIn([...ADMIN_PAYMENT_STATUSES])
  paymentStatus?: string;

  @ApiPropertyOptional({
    description: 'Filter by payment method (e.g. CASH, VODAFONE_CASH).',
  })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({
    description: 'Filter bookings created on or after date (ISO8601).',
  })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter bookings created on or before date (ISO8601).',
  })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({
    description: 'Filter trips departing on or after date (ISO8601).',
  })
  @IsOptional()
  @IsDateString()
  departureFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter trips departing on or before date (ISO8601).',
  })
  @IsOptional()
  @IsDateString()
  departureTo?: string;

  @ApiPropertyOptional({
    description: 'If true, filter only bookings with driver incident reports.',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasReports?: boolean;
}

export class AdminForceCancelBookingDto {
  @ApiProperty({
    example: 'Emergency route reroute',
    description: 'Administrative reason for cancellation.',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description:
      'Whether to restore reserved seats to trip available inventory.',
  })
  @IsOptional()
  @IsBoolean()
  releaseSeats?: boolean;
}

export class AdminReinstateBookingDto {
  @ApiProperty({
    example: 'Cancellation was performed in error',
    description: 'Administrative reason for reinstatement.',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class AdminOperationalOverrideDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Override boarding status.',
  })
  @IsOptional()
  @IsBoolean()
  boarded?: boolean;

  @ApiPropertyOptional({
    enum: [...ADMIN_DROP_STATUSES],
    example: 'DROPPED_OFF',
    description: 'Override drop status.',
  })
  @IsOptional()
  @IsString()
  @IsIn([...ADMIN_DROP_STATUSES])
  dropStatus?: string;

  @ApiPropertyOptional({
    example: 'station-123',
    description: 'Drop-off station id.',
  })
  @IsOptional()
  @IsString()
  dropStationId?: string;

  @ApiPropertyOptional({
    example: 'Passenger exited normally',
    description: 'Operational drop-off note or reason.',
  })
  @IsOptional()
  @IsString()
  dropReason?: string;

  @ApiProperty({
    example: 'Driver mobile battery died during trip',
    description: 'Administrative reason for operational override.',
  })
  @IsString()
  @IsNotEmpty()
  justification!: string;
}
