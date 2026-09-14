import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerifyTripShareDto {
  @ApiProperty({
    example: '482913',
    description: '6-digit numeric verification code',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'verificationCode must be exactly 6 digits' })
  verificationCode!: string;
}

export class CreateTripShareResponseDto {
  @ApiProperty({ format: 'uuid' })
  shareId!: string;

  @ApiProperty({ example: '482913' })
  verificationCode!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}

export class TripShareBusDto {
  @ApiProperty({ example: 'ق ب أ 1234' })
  plateNumber!: string;
}

export class TripShareTripDto {
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

  @ApiProperty({ type: () => TripShareBusDto })
  bus!: TripShareBusDto;
}

export class TripShareTrackingDto {
  @ApiProperty({ example: 'firebase_rtdb' })
  provider!: string;

  @ApiProperty({ example: 'trips/7f000001-91ea-13b2-8191-ea1c00000001' })
  channel!: string;
}

export class VerifiedTripShareResponseDto {
  @ApiProperty({ format: 'uuid' })
  shareId!: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  passengerName!: string;

  @ApiProperty({ type: () => TripShareTripDto })
  trip!: TripShareTripDto;

  @ApiProperty({ type: () => TripShareTrackingDto })
  tracking!: TripShareTrackingDto;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}
