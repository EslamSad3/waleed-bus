import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Documentation-only response model for the caller's own profile. */
export class OwnerProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: 'Ahmed Hassan' })
  name?: string;

  @ApiPropertyOptional({ example: 'Ahmed' })
  nickname?: string;

  @ApiPropertyOptional({ example: 'admin@bus.local', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ example: '01001234567', nullable: true })
  phoneNumber?: string | null;

  @ApiPropertyOptional({ maxLength: 1024, nullable: true })
  picture?: string | null;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ahmed Hassan', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'Ahmed', maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  nickname?: string;

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

export class AddDriverDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Existing user id to invite (either userId or phone+name+password).' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ example: 'Karim Driver', description: 'Required when userId is omitted.' })
  @ValidateIf((o: AddDriverDto) => !o.userId)
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ example: 'Karim', description: 'Required when userId is omitted.' })
  @ValidateIf((o: AddDriverDto) => !o.userId)
  @IsString()
  @Length(1, 100)
  nickname?: string;

  @ApiPropertyOptional({ example: '01001234567', description: 'Required when userId is omitted.' })
  @ValidateIf((o: AddDriverDto) => !o.userId)
  @IsString()
  @Matches(/^(?:\+20|0020|0)?1\d{9}$/, {
    message: 'phone must be a valid Egyptian mobile number',
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'Passw0rd!123', format: 'password', minLength: 8, maxLength: 128, description: 'Required when userId is omitted.' })
  @ValidateIf((o: AddDriverDto) => !o.userId)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  picture?: string;

  @ApiPropertyOptional({ example: '29801011234567' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$/, { message: 'nationalId must be exactly 14 digits' })
  nationalId?: string;

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
