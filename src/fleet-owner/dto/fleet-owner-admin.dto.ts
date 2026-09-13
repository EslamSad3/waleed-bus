import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateFleetOwnerDto {
  @ApiProperty({ example: 'Ahmed Hassan', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 'Ahmed', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  nickname!: string;

  @ApiProperty({ example: '01001234567' })
  @IsString()
  @Matches(/^(?:\+20|0020|0)?1\d{9}$/, {
    message: 'phone must be a valid Egyptian mobile number',
  })
  phone!: string;

  @ApiProperty({ example: 'Passw0rd!123', format: 'password', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ maxLength: 1024, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  picture?: string;

  @ApiPropertyOptional({ example: '29801011234567', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$/, { message: 'nationalId must be exactly 14 digits' })
  nationalId?: string;

  @ApiProperty({ example: 'Ahmed Transport', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  fleetName!: string;
}

export class UpdateFleetOwnerDto {
  @ApiPropertyOptional({ example: 'Ahmed Hassan', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ example: 'Ahmed', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  nickname?: string;

  @ApiPropertyOptional({ example: '01001234567' })
  @IsOptional()
  @IsString()
  @Matches(/^(?:\+20|0020|0)?1\d{9}$/, {
    message: 'phone must be a valid Egyptian mobile number',
  })
  phone?: string;

  @ApiPropertyOptional({ maxLength: 1024, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  picture?: string;

  @ApiPropertyOptional({ example: '29801011234567', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^(?:\d{14})?$/, { message: 'nationalId must be exactly 14 digits or empty' })
  nationalId?: string;

  @ApiPropertyOptional({ example: true, description: 'Deactivating revokes active sessions.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class FleetOwnerFleetDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ahmed Transport' })
  name!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;
}

export class FleetOwnerAccountDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  name!: string;

  @ApiProperty({ example: 'Ahmed' })
  nickname!: string;

  @ApiProperty({ example: '01001234567' })
  phoneNumber!: string;

  @ApiPropertyOptional({ nullable: true })
  picture!: string | null;

  @ApiPropertyOptional({ nullable: true })
  nationalId!: string | null;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ type: [FleetOwnerFleetDto] })
  fleets!: FleetOwnerFleetDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}
