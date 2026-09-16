import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

const EGYPT_PHONE = /^(\+20|0)1[0-9]{9}$/;

/** Platform onboarding payload: an owner account and its first fleet are one atomic operation. */
export class CreateFleetOwnerDto {
  @ApiProperty({ example: 'محمد نعماني', maxLength: 255 })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 'محمد', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  nickname!: string;

  @ApiProperty({ example: '01001234567' })
  @IsString()
  @Matches(EGYPT_PHONE)
  phone!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'أسطول النيل', maxLength: 255 })
  @IsString()
  @Length(1, 255)
  fleetName!: string;

  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  picture?: string;

  @ApiPropertyOptional({ example: '29801011234567', minLength: 14, maxLength: 14 })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  nationalId?: string;
}

/** Editable owner profile fields; fleet management remains on the fleet screens. */
export class UpdateFleetOwnerDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  nickname?: string;

  @ApiPropertyOptional({ example: '01001234567' })
  @IsOptional()
  @IsString()
  @Matches(EGYPT_PHONE)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  picture?: string;

  @ApiPropertyOptional({ minLength: 14, maxLength: 14 })
  @IsOptional()
  @IsString()
  @Length(0, 14)
  nationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
