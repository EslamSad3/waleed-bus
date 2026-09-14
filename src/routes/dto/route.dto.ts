import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class StationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ramses Station' })
  name!: string;

  @ApiPropertyOptional({ example: 'Ramses Square, Cairo' })
  address?: string | null;

  @ApiPropertyOptional({ example: 30.0631 })
  latitude?: number | null;

  @ApiPropertyOptional({ example: 31.2497 })
  longitude?: number | null;

  @ApiPropertyOptional({ example: 1 })
  stopOrder?: number;

  @ApiPropertyOptional({ example: 0 })
  estimatedStopMinutes?: number | null;
}

export class RouteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Cairo - Alexandria Express' })
  name!: string;

  @ApiProperty({ example: 'CAI-ALX-01' })
  code!: string;

  @ApiProperty({ example: 'Cairo' })
  origin!: string;

  @ApiProperty({ example: 'Alexandria' })
  destination!: string;

  @ApiProperty({ example: 'qr_route_cai_alx_01' })
  qrIdentifier!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ type: () => [StationDto] })
  stations?: StationDto[];
}

export class CreateRouteDto {
  @ApiProperty({
    example: 'Cairo - Alexandria Express',
    minLength: 1,
    maxLength: 255,
  })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 'CAI-ALX-01', minLength: 1, maxLength: 50 })
  @IsString()
  @Length(1, 50)
  code!: string;

  @ApiProperty({ example: 'Cairo', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  origin!: string;

  @ApiProperty({ example: 'Alexandria', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  destination!: string;

  @ApiProperty({ example: 'qr_route_cai_alx_01', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  qrIdentifier!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateStationDto {
  @ApiProperty({ example: 'Ramses Station', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiPropertyOptional({ example: 'Ramses Square, Cairo', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string;

  @ApiPropertyOptional({ example: 30.0631 })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 31.2497 })
  @IsOptional()
  @IsNumber()
  longitude?: number;
}

export class AddRouteStationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stationId!: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  stopOrder!: number;

  @ApiPropertyOptional({ example: 45, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedStopMinutes?: number;
}

export class PublicRouteUpcomingTripBusDto {
  @ApiPropertyOptional({ example: 'ق ب أ 1234' })
  plateNumber?: string | null;
}

export class PublicRouteUpcomingTripDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  departAt!: Date;

  @ApiProperty({ example: '50.00' })
  fare!: string;

  @ApiProperty({ example: 14 })
  capacity!: number;

  @ApiProperty({ example: 4 })
  availableSeats!: number;

  @ApiProperty({ type: () => PublicRouteUpcomingTripBusDto })
  bus!: PublicRouteUpcomingTripBusDto;
}

export class PublicRouteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Cairo - Alexandria Express' })
  name!: string;

  @ApiProperty({ example: 'CAI-ALX-01' })
  code!: string;

  @ApiProperty({ example: 'Cairo' })
  origin!: string;

  @ApiProperty({ example: 'Alexandria' })
  destination!: string;

  @ApiProperty({ example: 'qr_route_cai_alx_01' })
  qrIdentifier!: string;

  @ApiProperty({ type: () => [StationDto] })
  stations!: StationDto[];

  @ApiProperty({ type: () => [PublicRouteUpcomingTripDto] })
  upcomingTrips!: PublicRouteUpcomingTripDto[];
}
