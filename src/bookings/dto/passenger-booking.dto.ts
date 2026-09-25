import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
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

// PostgreSQL accepts UUID-shaped IDs even when their version bits are not an
// RFC UUID version. Local imported/seeded data contains such stable IDs, and
// the public trip search returns them verbatim. Keep the boundary strict about
// the database UUID shape without incorrectly requiring RFC version bits.
const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreatePassengerBookingDto {
  @ApiProperty({ format: 'uuid', description: 'Target scheduled trip' })
  @Matches(POSTGRES_UUID_PATTERN, { message: 'tripId must be a UUID' })
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

  @ApiProperty({ format: 'uuid', description: 'Boarding stop selected from this trip line.' })
  @Matches(POSTGRES_UUID_PATTERN, {
    message: 'boardingStationId must be a UUID',
  })
  boardingStationId!: string;

  @ApiProperty({ format: 'uuid', description: 'Landing stop selected from this trip line.' })
  @Matches(POSTGRES_UUID_PATTERN, {
    message: 'landingStationId must be a UUID',
  })
  landingStationId!: string;
  @ApiPropertyOptional({ maxLength: 500, description: 'Passenger pickup address shown to the driver.' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  pickupAddress?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  pickupLatitude?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  pickupLongitude?: number;

  @ApiPropertyOptional({ default: false, description: 'Passenger confirmed that the supplied current location is their pickup location.' })
  @IsOptional()
  @IsBoolean()
  pickupLocationConfirmed?: boolean;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'Set to true to override a DUPLICATE_TIME_BOOKING conflict',
  })
  @IsOptional()
  @IsBoolean()
  confirmTimeConflict?: boolean;

  @ApiPropertyOptional({ enum: ['SELF', 'OTHER'], default: 'SELF', description: 'Who travels: the booker or someone else.' })
  @IsOptional()
  @IsString()
  @IsIn(['SELF', 'OTHER'])
  bookingFor?: 'SELF' | 'OTHER';

  @ApiPropertyOptional({ example: 'Mona Ahmed', maxLength: 255, description: 'Required when bookingFor is OTHER; ignored for SELF (snapshot comes from the account).' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  passengerName?: string;

  @ApiPropertyOptional({ example: '01012345678', maxLength: 30, description: 'Required when bookingFor is OTHER.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  passengerPhone?: string;

  @ApiPropertyOptional({ example: 'Wait near the bridge.', maxLength: 1000, description: 'Free-form note visible to the driver/operator.' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  note?: string;

  @ApiPropertyOptional({ example: 'SAVE10', description: 'Promo code applied at checkout. Unknown/expired codes are ignored at full price; exhausted or already-used codes raise.' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  promoCode?: string;
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
    description: 'Cursor pagination token (opaque; pass back nextCursor verbatim).',
  })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ق ب أ 1234' })
  plateNumber?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'BUS-001' })
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

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  passengerUserId?: string | null;

  @ApiProperty({ example: 'Ahmed Hassan' })
  passengerName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '01000000000' })
  passengerPhone?: string | null;

  @ApiProperty({ example: 2 })
  seats!: number;

  @ApiProperty({ example: 'CONFIRMED' })
  status!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'CASH' })
  paymentMethod?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'PENDING' })
  paymentStatus?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '100.00' })
  totalAmount?: string | null;

  @ApiPropertyOptional({ type: String, example: 'SAVE10', nullable: true })
  promoCode?: string | null;

  @ApiProperty({ example: '10.00' })
  discountAmount!: string;

  @ApiPropertyOptional({ type: String, example: 'OK', nullable: true, description: 'Promo outcome echoed on create only.' })
  promoStatus?: string | null;

  @ApiProperty({ enum: ['SELF', 'OTHER'], example: 'SELF' })
  bookingFor!: string;

  @ApiPropertyOptional({ type: String, example: 'Wait near the bridge.', nullable: true })
  note?: string | null;

  @ApiProperty({ format: 'date-time' })
  confirmedAt!: Date;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  boardedAt?: Date | null;

  @ApiPropertyOptional({ type: Date, format: 'date-time', nullable: true })
  droppedAt?: Date | null;

  @ApiPropertyOptional({ type: Number, example: 5, nullable: true })
  busRating?: number | null;

  @ApiPropertyOptional({ type: Number, example: 5, nullable: true })
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

  @ApiPropertyOptional({ type: String, example: 'Change of plans', nullable: true })
  cancellationReason?: string | null;
}

export class ActiveTripDriverDto {
  @ApiPropertyOptional({ type: String, example: 'Mohamed Ibrahim', nullable: true })
  name?: string | null;

  @ApiPropertyOptional({ type: String, example: '01100000000', nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ type: String, example: null, nullable: true })
  picture?: string | null;
}

export class ActiveTripBusDto {
  @ApiPropertyOptional({ type: String, example: 'ق ب أ 1234', nullable: true })
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
