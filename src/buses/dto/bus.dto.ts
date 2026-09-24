import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

/** Documentation-only response model for a bus row. */
export class VehicleBrandDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Mercedes' })
  name!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: 0 })
  sortOrder!: number;
}

export class CreateVehicleBrandDto {
  @ApiProperty({ example: 'Mercedes', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVehicleBrandDto {
  @ApiPropertyOptional({ example: 'Mercedes' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fleetId!: string;

  @ApiProperty({ example: 'BUS-A-001', minLength: 1, maxLength: 50 })
  registrationNumber!: string;

  @ApiPropertyOptional({ example: 'ABC-1234', maxLength: 50 })
  plateNumber?: string | null;

  @ApiPropertyOptional({ example: 'أبيض', maxLength: 50 })
  color?: string | null;

  @ApiPropertyOptional({ example: 'https://example.com/buses/bus-1.jpg' })
  imageUrl?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  brandId?: string | null;

  @ApiPropertyOptional({ type: () => VehicleBrandDto })
  brand?: VehicleBrandDto | null;

  @ApiPropertyOptional({ example: true })
  isAirConditioned?: boolean | null;

  @ApiPropertyOptional({ example: 2022 })
  modelYear?: number | null;

  @ApiProperty({ example: 45, minimum: 1, maximum: 300 })
  capacity!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class CreateBusDto {
  @ApiProperty({
    example: 'BUS-A-002',
    minLength: 1,
    maxLength: 50,
    description: 'Unique within the fleet (409 otherwise).',
  })
  @IsString()
  @Length(1, 50)
  registrationNumber!: string;

  @ApiProperty({ example: 'ABC-1234', minLength: 1, maxLength: 50 })
  @IsString()
  @Length(1, 50)
  plateNumber!: string;

  @ApiProperty({ example: 'أبيض', minLength: 1, maxLength: 50 })
  @IsString()
  @Length(1, 50)
  color!: string;

  @ApiProperty({ example: 'https://example.com/buses/bus-1.jpg', description: 'Absolute HTTPS URL of the bus image (Supabase Storage URL; bucket provisioning is a follow-up).' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(1, 1024)
  imageUrl!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Admin-managed vehicle brand. Must be active.' })
  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isAirConditioned?: boolean;

  @ApiPropertyOptional({ example: 2022, minimum: 1980, maximum: 2100 })
  @IsOptional()
  @IsInt()
  @Min(1980)
  @Max(2100)
  modelYear?: number;

  @ApiProperty({ example: 45, minimum: 1, maximum: 300 })
  @IsInt()
  @Min(1)
  @Max(300)
  capacity!: number;
}

export class UpdateBusDto {
  @ApiPropertyOptional({ example: 'ABC-1234', maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  plateNumber?: string;

  @ApiPropertyOptional({ example: 'أبيض', maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  color?: string;

  @ApiPropertyOptional({ example: 'https://example.com/buses/bus-1.jpg' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(1, 1024)
  imageUrl?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Admin-managed vehicle brand. Must be active.' })
  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isAirConditioned?: boolean;

  @ApiPropertyOptional({ example: 2022, minimum: 1980, maximum: 2100 })
  @IsOptional()
  @IsInt()
  @Min(1980)
  @Max(2100)
  modelYear?: number;

  @ApiPropertyOptional({ example: 45, minimum: 1, maximum: 300 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  capacity?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
