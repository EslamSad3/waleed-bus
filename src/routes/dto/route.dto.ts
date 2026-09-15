import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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

/** Platform management DTOs. A Station is presented to operators as a stop. */
export class CreateStopDto {
  @ApiProperty({ example: 'ميدان رمسيس' })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 'ميدان رمسيس، القاهرة' })
  @IsString()
  @Length(1, 500)
  address!: string;

  @ApiProperty({ example: 30.0626, minimum: -90, maximum: 90 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 31.2467, minimum: -180, maximum: 180 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStopDto {
  @ApiPropertyOptional({ example: 'ميدان رمسيس' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ example: 'ميدان رمسيس، القاهرة' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string;

  @ApiPropertyOptional({ example: 30.0626, minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 31.2467, minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TripLineStopDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stopId!: string;

  @ApiPropertyOptional({ example: 5, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedStopMinutes?: number;
}

export class CreateTripLineDto {
  @ApiProperty({ example: 'القاهرة – بني سويف' })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 'CAI-BNS-01' })
  @IsString()
  @Length(1, 50)
  code!: string;

  @ApiProperty({ type: () => [TripLineStopDto], minItems: 2 })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => TripLineStopDto)
  outboundStops!: TripLineStopDto[];

  @ApiProperty({ type: () => [TripLineStopDto], minItems: 2 })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => TripLineStopDto)
  returnStops!: TripLineStopDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTripLineDto {
  @ApiPropertyOptional({ example: 'القاهرة – بني سويف' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ example: 'CAI-BNS-01' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDirectionalRouteStopsDto {
  @ApiProperty({ type: () => [TripLineStopDto], minItems: 2 })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => TripLineStopDto)
  stops!: TripLineStopDto[];
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
