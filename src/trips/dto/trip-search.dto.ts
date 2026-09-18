import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class TripSearchQueryDto {
  @ApiProperty({ example: 'Cairo', description: 'Origin city or station' })
  @IsOptional()
  @IsString()
  origin?: string;

  @ApiProperty({
    example: 'Alexandria',
    description: 'Destination city or station',
  })
  @IsOptional()
  @IsString()
  destination?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Boarding stop id. Use with destinationStopId for stop-based passenger search.' })
  @IsOptional()
  @IsUUID()
  originStopId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Drop-off stop id. Use with originStopId for stop-based passenger search.' })
  @IsOptional()
  @IsUUID()
  destinationStopId?: string;

  @ApiProperty({
    example: '2026-09-15',
    description:
      'Scheduled date of departure (YYYY-MM-DD format, calendar day match)',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in YYYY-MM-DD format',
  })
  date!: string;

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

export class TripSearchBusDto {
  @ApiProperty({ example: 'ق ب أ 1234' })
  plateNumber!: string;
}

export class TripSearchFleetOwnerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Waleed Transport' })
  name!: string;

  @ApiPropertyOptional({ example: 'El Waleed', nullable: true, description: 'Passenger-facing familiar name for the fleet owner.' })
  nickname?: string | null;
}

export class TripSearchStopDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  address?: string | null;

  @ApiProperty({ enum: ['BOARDING', 'LANDING', 'BOTH'] })
  stopType!: string;
}

export class TripSearchResultItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  routeId?: string | null;

  @ApiPropertyOptional({
    example: 'Cairo - Alexandria Express',
    nullable: true,
  })
  routeName?: string | null;

  @ApiProperty({ example: 'Cairo' })
  origin!: string;

  @ApiProperty({ example: 'Alexandria' })
  destination!: string;

  @ApiProperty({ example: '2026-09-15T08:00:00.000Z', format: 'date-time' })
  departAt!: Date;

  @ApiProperty({ example: '50.00' })
  fare!: string;

  @ApiProperty({ example: 'SCHEDULED' })
  status!: string;

  @ApiProperty({ example: 14 })
  capacity!: number;

  @ApiProperty({ example: 6 })
  availableSeats!: number;

  @ApiProperty({ example: ['CASH', 'VODAFONE_CASH'], type: [String] })
  paymentMethods!: string[];

  @ApiProperty({ type: () => TripSearchBusDto })
  bus!: TripSearchBusDto;

  @ApiProperty({ type: () => TripSearchFleetOwnerDto })
  fleetOwner!: TripSearchFleetOwnerDto;

  @ApiProperty({ type: () => [TripSearchStopDto] })
  stops!: TripSearchStopDto[];
}

export class TripStationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ramses Station' })
  name!: string;

  @ApiProperty({ example: 1 })
  stopOrder!: number;

  @ApiPropertyOptional({ example: 0, nullable: true })
  estimatedStopMinutes?: number | null;
}

export class TripRouteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Cairo - Alexandria Express' })
  name!: string;

  @ApiProperty({ example: 'CAI-ALX-01' })
  code!: string;

  @ApiProperty({ type: () => [TripStationDto] })
  stations!: TripStationDto[];
}

export class TripDetailBusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ق ب أ 1234' })
  plateNumber!: string;

  @ApiPropertyOptional({ example: 'BUS-001' })
  registrationNumber?: string | null;
}

export class TripDetailsResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Cairo' })
  origin!: string;

  @ApiProperty({ example: 'Alexandria' })
  destination!: string;

  @ApiProperty({ example: '2026-09-15T08:00:00.000Z', format: 'date-time' })
  departAt!: Date;

  @ApiProperty({ example: '50.00' })
  fare!: string;

  @ApiProperty({ example: 'SCHEDULED' })
  status!: string;

  @ApiProperty({ example: 14 })
  capacity!: number;

  @ApiProperty({ example: 6 })
  availableSeats!: number;

  @ApiProperty({ example: ['CASH', 'VODAFONE_CASH'], type: [String] })
  paymentMethods!: string[];

  @ApiPropertyOptional({ type: () => TripRouteDto, nullable: true })
  route?: TripRouteDto | null;

  @ApiProperty({ type: () => TripDetailBusDto })
  bus!: TripDetailBusDto;
}
