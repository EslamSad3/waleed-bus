import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import type { NotificationCategory } from '../notifications.service.js';

export class SendPlatformNotificationDto {
  @ApiPropertyOptional({
    description:
      'Target specific user UUID. Required if isGlobal is false or omitted.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @ApiPropertyOptional({
    description:
      'If true, notification is broadcast to all active users.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @ApiPropertyOptional({
    enum: ['TEXT', 'TRIP', 'DISCOUNT_CODE'],
    default: 'TEXT',
  })
  @IsOptional()
  @IsIn(['TEXT', 'TRIP', 'DISCOUNT_CODE'])
  category?: NotificationCategory;

  @ApiProperty({
    example: 'تنبيه هام',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiProperty({
    example: 'يرجى العلم بأنه تم تحديث جدول مواعيد الرحلات.',
    minLength: 1,
    maxLength: 2000,
  })
  @IsString()
  @Length(1, 2000)
  body!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  tripId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  promotionId?: string | null;
}

export class SendPlatformNotificationResponseDto {
  @ApiProperty({ example: 1 })
  sentCount!: number;

  @ApiProperty({ example: false })
  isGlobal!: boolean;

  @ApiProperty({ type: [String], format: 'uuid' })
  notificationIds!: string[];
}
