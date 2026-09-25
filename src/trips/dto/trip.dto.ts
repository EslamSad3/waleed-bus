import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export const TRIP_STATUSES = [
  'SCHEDULED',
  'DEPARTED',
  'COMPLETED',
  'CANCELLED',
] as const;
export const BOOKING_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;

/** Documentation-only response model for a trip row. */
export class TripDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fleetId!: string;

  @ApiProperty({ format: 'uuid' })
  busId!: string;

  @ApiProperty({ example: 'Cairo' })
  origin!: string;

  @ApiProperty({ example: 'Alexandria' })
  destination!: string;

  @ApiProperty({ example: '2026-09-10T08:00:00.000Z', format: 'date-time' })
  departAt!: Date;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  routeId?: string | null;

  @ApiProperty({ example: '50.00' })
  fare!: string;

  @ApiProperty({ enum: [...TRIP_STATUSES], example: 'SCHEDULED' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** Documentation-only response model for a booking row. */
export class BookingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fleetId!: string;

  @ApiProperty({ format: 'uuid' })
  tripId!: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  passengerName!: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  passengerPhone?: string;

  @ApiProperty({ example: 1, minimum: 1 })
  seats!: number;

  @ApiProperty({ enum: [...BOOKING_STATUSES], example: 'CONFIRMED' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class CreateTripDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Bus id — must belong to the same fleet (cross-fleet bus ids resolve to 404).',
  })
  @IsUUID()
  busId!: string;

  @ApiProperty({ example: 'Cairo', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  origin!: string;

  @ApiProperty({ example: 'Alexandria', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  destination!: string;

  @ApiProperty({ example: '2026-09-10T08:00:00.000Z', format: 'date-time' })
  @IsDateString()
  departAt!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({ example: '50.00' })
  @IsOptional()
  @IsString()
  fare?: string;

  @ApiPropertyOptional({ enum: [...TRIP_STATUSES], default: 'SCHEDULED' })
  @IsOptional()
  @IsIn([...TRIP_STATUSES])
  status?: string;
}

export class UpdateTripDto {
  @ApiPropertyOptional({ example: 'Cairo', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  origin?: string;

  @ApiPropertyOptional({ example: 'Alexandria', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  destination?: string;

  @ApiPropertyOptional({
    example: '2026-09-10T08:00:00.000Z',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  departAt?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({ example: '50.00' })
  @IsOptional()
  @IsString()
  fare?: string;

  @ApiPropertyOptional({ enum: [...TRIP_STATUSES] })
  @IsOptional()
  @IsIn([...TRIP_STATUSES])
  status?: string;
}

export class CreateBookingDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Trip id — must belong to the same fleet (cross-fleet trip ids resolve to 404).',
  })
  @IsUUID()
  tripId!: string;

  @ApiProperty({ example: 'Ahmed Hassan', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  passengerName!: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{6,20}$/, {
    message: 'passengerPhone must be a phone number',
  })
  passengerPhone?: string;

  @ApiPropertyOptional({ enum: [...BOOKING_STATUSES], default: 'CONFIRMED' })
  @IsOptional()
  @Matches(/^(CONFIRMED|CANCELLED)$/)
  status?: string;
}

export class UpdateBookingDto {
  @ApiPropertyOptional({
    example: 'Ahmed Hassan',
    minLength: 1,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  passengerName?: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{6,20}$/, {
    message: 'passengerPhone must be a phone number',
  })
  passengerPhone?: string;

  @ApiPropertyOptional({ enum: [...BOOKING_STATUSES] })
  @IsOptional()
  @IsIn([...BOOKING_STATUSES])
  status?: string;
}
