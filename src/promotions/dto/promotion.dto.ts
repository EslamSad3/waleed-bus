import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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

  @ApiProperty({ enum: ['PERCENTAGE', 'FIXED'], example: 'PERCENTAGE' })
  @IsString()
  @IsIn(['PERCENTAGE', 'FIXED'])
  type!: 'PERCENTAGE' | 'FIXED';

  @ApiProperty({ example: 10, description: 'Percent 1-100 or fixed EGP amount.' })
  @IsNumber()
  @IsPositive()
  value!: number;

  @ApiPropertyOptional({ example: 50, description: 'Caps PERCENTAGE discounts.' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxDiscountAmount?: number;

  @ApiPropertyOptional({ default: true, description: 'False = only targeted users.' })
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @ApiPropertyOptional({ example: ['user-uuid'], description: 'Required when isGlobal=false.' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  targetUserIds?: string[];

  @ApiPropertyOptional({ default: 1, description: 'Max redemptions per user.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerUser?: number;

  @ApiPropertyOptional({ description: 'Null = unlimited platform-wide.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxTotalUses?: number | null;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}

export class UpdatePromotionDto {
  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  value?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxDiscountAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerUser?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxTotalUses?: number | null;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
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

  @ApiProperty({ enum: ['PERCENTAGE', 'FIXED'] })
  type!: string;

  @ApiProperty({ example: '10.00' })
  value!: string;

  @ApiPropertyOptional({ example: '50.00' })
  maxDiscountAmount!: string | null;

  @ApiProperty()
  isGlobal!: boolean;

  @ApiProperty()
  maxUsesPerUser!: number;

  @ApiPropertyOptional()
  maxTotalUses!: number | null;

  @ApiPropertyOptional({ format: 'date-time' })
  startsAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  expiresAt!: string | null;

  @ApiProperty()
  isActive!: boolean;
}
