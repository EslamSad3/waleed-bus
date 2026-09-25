import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Documentation-only response model for the caller's own profile. */
export class OwnerProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: 'Ahmed Hassan' })
  name?: string;

  @ApiPropertyOptional({ type: String, example: 'admin@bus.local', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ type: String, example: '01001234567', nullable: true })
  phoneNumber?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 1024, nullable: true })
  picture?: string | null;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ahmed Hassan', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ maxLength: 1024, description: 'Public avatar URL.' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  picture?: string;
}

/** Reuses the platform bus shapes (see src/buses/dto/bus.dto.ts). */
export class CreateFleetBusDto {
  @ApiProperty({ example: 'BUS-A-002', minLength: 1, maxLength: 50, description: 'Unique within the fleet (409 otherwise).' })
  @IsString()
  @Length(1, 50)
  registrationNumber!: string;

  @ApiPropertyOptional({ example: 'ABC-1234', maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  plateNumber?: string;

  @ApiProperty({ example: 45, minimum: 1, maximum: 300 })
  @IsInt()
  @Min(1)
  @Max(300)
  capacity!: number;
}

export class UpdateFleetBusDto {
  @ApiPropertyOptional({ example: 'ABC-1234', maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  plateNumber?: string;

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

export class AssignDriverDto {
  @ApiProperty({ format: 'uuid', description: 'Driver user id (must hold an ACTIVE driver membership in the fleet).' })
  @IsUUID()
  driverUserId!: string;
}

/** A trip line is platform-defined; a fleet assigns it to one of its buses. */
export class AssignTripLineDto {
  @ApiProperty({ format: 'uuid', description: 'Active system trip-line id.' })
  @IsUUID()
  tripLineId!: string;
}

export class AddDriverDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Existing user id to invite (either userId or phone+name+password).' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ example: 'Karim Driver' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'Karim', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string;

  @ApiPropertyOptional({ example: '01001234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: '29801011234567', minLength: 14, maxLength: 14 })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  nationalId?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/drivers/karim.jpg', maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  picture?: string;

  @ApiPropertyOptional({ example: 'Passw0rd!123', format: 'password', minLength: 8, maxLength: 128 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ example: 'driver', description: 'Role slug for the new membership (defaults to driver).' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  roleSlug?: string;
}

export class UpdateDriverDto {
  @ApiPropertyOptional({ example: 'driver' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  roleSlug?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'REVOKED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'REVOKED'])
  status?: string;
}

export class FleetReportsQueryDto {
  @ApiPropertyOptional({ enum: ['passenger_reports', 'ratings'] })
  @IsOptional()
  @IsIn(['passenger_reports', 'ratings'])
  type?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsString()
  to?: string;
}
