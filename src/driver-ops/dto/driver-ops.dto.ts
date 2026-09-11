import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class DropOffDto {
  @ApiProperty({ enum: ['DROPPED_OFF', 'NOT_DROPPED_OFF'] })
  @IsIn(['DROPPED_OFF', 'NOT_DROPPED_OFF'])
  status!: string;

  @ApiPropertyOptional({ description: 'Station id — required when status is DROPPED_OFF.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  stationId?: string;

  @ApiPropertyOptional({ description: 'Reason — required when status is NOT_DROPPED_OFF.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CashPaymentDto {
  @ApiProperty({ enum: ['CASH'], description: 'Only cash is accepted on-device; the amount is read-only from the booking.' })
  @IsIn(['CASH'])
  method!: string;

  @ApiProperty({ enum: ['PAID'] })
  @IsIn(['PAID'])
  status!: string;
}

export class PassengerRatingDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;
}

export class BookingRatingDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  busRating!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  driverRating!: number;
}

export class PassengerReportDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;
}

export class DriverTripsQueryDto {
  @ApiPropertyOptional({ enum: ['SCHEDULED', 'DEPARTED', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['SCHEDULED', 'DEPARTED', 'COMPLETED', 'CANCELLED'])
  status?: string;

  @ApiPropertyOptional({ description: 'Opaque cursor of the last item of the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsString()
  limit?: string;
}

export class UpdateDriverProfileDto {
  @ApiPropertyOptional({ example: 'Karim Driver', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  picture?: string;
}

/** Documents the :tripId / :bookingId / :busId uuid params shared by driver routes. */
export class DriverTripParams {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tripId!: string;
}

export class ClaimBusDto {
  @ApiProperty({ format: 'uuid', description: 'Owned-fleet bus to claim as the operating bus.' })
  @IsUUID()
  busId!: string;
}
