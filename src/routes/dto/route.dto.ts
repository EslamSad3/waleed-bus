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
  IsIn,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GovernorateDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CAIRO' })
  code!: string;

  @ApiProperty({ example: 'القاهرة' })
  nameAr!: string;

  @ApiProperty({ example: 'Cairo' })
  nameEn!: string;
}

export class StationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ramses Station' })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Ramses Square, Cairo' })
  address?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 30.0631 })
  latitude?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 31.2497 })
  longitude?: number | null;

  @ApiPropertyOptional({ example: 1 })
  stopOrder?: number;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 0 })
  estimatedStopMinutes?: number | null;

  @ApiPropertyOptional({ type: () => GovernorateDto })
  governorate?: GovernorateDto;

  @ApiPropertyOptional({ type: () => LocalityDto, description: 'Physical locality chain (locality → markaz → governorate).' })
  locality?: LocalityDto | null;
}

export class MarkazDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  governorateId!: string;

  @ApiProperty({ example: 'BANHA' })
  code!: string;

  @ApiProperty({ example: 'بنها' })
  nameAr!: string;

  @ApiProperty({ example: 'Banha' })
  nameEn!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ type: () => GovernorateDto })
  governorate?: GovernorateDto;
}

export class CreateMarkazDto {
  @ApiProperty({ format: 'uuid', description: 'Governorate this markaz belongs to.' })
  @IsUUID()
  governorateId!: string;

  @ApiProperty({ example: 'BANHA', minLength: 1, maxLength: 50 })
  @IsString()
  @Length(1, 50)
  code!: string;

  @ApiProperty({ example: 'بنها', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  nameAr!: string;

  @ApiProperty({ example: 'Banha', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  nameEn!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateMarkazDto {
  @ApiPropertyOptional({ example: 'بنها' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  nameAr?: string;

  @ApiPropertyOptional({ example: 'Banha' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class LocalityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  markazId!: string;

  @ApiProperty({ example: 'بنها' })
  nameAr!: string;

  @ApiProperty({ example: 'Banha' })
  nameEn!: string;

  @ApiProperty({ enum: ['CITY', 'VILLAGE'], example: 'CITY' })
  type!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ type: () => MarkazDto })
  markaz?: MarkazDto;
}

export class CreateLocalityDto {
  @ApiProperty({ format: 'uuid', description: 'Markaz this locality belongs to.' })
  @IsUUID()
  markazId!: string;

  @ApiProperty({ example: 'بنها', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  nameAr!: string;

  @ApiProperty({ example: 'Banha', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  nameEn!: string;

  @ApiProperty({ enum: ['CITY', 'VILLAGE'], example: 'CITY' })
  @IsString()
  @IsIn(['CITY', 'VILLAGE'])
  type!: 'CITY' | 'VILLAGE';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateLocalityDto {
  @ApiPropertyOptional({ example: 'بنها' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  nameAr?: string;

  @ApiPropertyOptional({ example: 'Banha' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
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

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Ramses Square, Cairo', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string | null;

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

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ميدان رمسيس، القاهرة' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string | null;

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

  @ApiProperty({ format: 'uuid', description: 'Egyptian governorate for this stop.' })
  @IsUUID()
  governorateId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', description: 'City/village locality for this stop. Must belong to the stop governorate.' })
  @IsOptional()
  @IsUUID()
  localityId?: string | null;

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

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ميدان رمسيس، القاهرة' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string | null;

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

  @ApiPropertyOptional({ format: 'uuid', description: 'Egyptian governorate for this stop.' })
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', description: 'City/village locality for this stop. Must belong to the stop governorate.' })
  @IsOptional()
  @IsUUID()
  localityId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TripLineStopDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stopId!: string;

  @ApiProperty({ enum: ['BOARDING', 'LANDING'], description: 'Whether passengers may board or land at this stop. Legacy BOTH rows remain readable but can no longer be written.' })
  @IsString()
  @IsIn(['BOARDING', 'LANDING'])
  stopType!: 'BOARDING' | 'LANDING';

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
  @ApiPropertyOptional({ type: String, nullable: true, example: 'ق ب أ 1234' })
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
