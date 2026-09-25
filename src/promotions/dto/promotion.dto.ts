import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

export class CreatePromotionDto {
  @ApiProperty({ example: 'SAVE10', description: '3-32 chars A-Z 0-9 _ -; normalized UPPER-TRIM.' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,32}$/)
  code!: string;

  @ApiProperty({ enum: ['FIXED'], example: 'FIXED', description: 'FIXED only (fixed EGP amount, never percentage).' })
  @IsString()
  @IsIn(['FIXED'])
  type!: 'FIXED';

  @ApiProperty({ example: 50, description: 'Fixed EGP discount amount (positive).' })
  @IsNumber()
  @IsPositive()
  value!: number;

  @ApiPropertyOptional({ default: true, description: 'False = only targeted users.' })
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @ApiPropertyOptional({ example: ['user-uuid'], description: 'Required when isGlobal=false.' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  targetUserIds?: string[];

  @ApiPropertyOptional({ default: 1, description: 'Max redemptions per user.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerUser?: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Null = unlimited platform-wide.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxTotalUses?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}

export class UpdatePromotionDto {
  @ApiPropertyOptional({ example: 50, description: 'Fixed EGP discount amount (positive).' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerUser?: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxTotalUses?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: ['user-uuid'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  targetUserIds?: string[];
}

export class ValidatePromoDto {
  @ApiProperty({ example: 'SAVE10' })
  @IsString()
  code!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tripId!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  seatCount!: number;
}

export class PromotionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'SAVE10' })
  code!: string;

  @ApiProperty({ enum: ['FIXED'], example: 'FIXED' })
  type!: string;

  @ApiProperty({ example: '50.00', description: 'Fixed EGP discount amount.' })
  value!: string;

  @ApiProperty()
  isGlobal!: boolean;

  @ApiProperty({ example: [], description: 'Targeted user ids (platform responses only; empty for global codes).' })
  targetUserIds!: string[];

  @ApiProperty()
  maxUsesPerUser!: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  maxTotalUses!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  startsAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  expiresAt!: string | null;

  @ApiProperty()
  isActive!: boolean;
}
