import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class AdminVerifyPaymentDto {
  @ApiProperty({
    example: 'VF-9021849',
    maxLength: 100,
    description:
      'External transaction reference (e.g. Vodafone Cash / InstaPay transaction ID).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reference!: string;

  @ApiProperty({
    example: 100.0,
    description:
      'Verified amount received. Must strictly equal the booking totalAmount.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({
    example: 'VODAFONE_CASH',
    maxLength: 20,
    description: 'Payment method override or confirmation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  paymentMethod?: string;

  @ApiPropertyOptional({
    example: 'Verified in Vodafone Cash business account statement',
    maxLength: 500,
    description: 'Reconciliation notes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AdminRefundPaymentDto {
  @ApiProperty({
    example: 'REF-VF-10928',
    maxLength: 100,
    description: 'External refund transfer reference.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  refundReference!: string;

  @ApiProperty({
    example: 50.0,
    description:
      'Refund amount. Must not exceed the remaining unrefunded booking balance.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  refundAmount!: number;

  @ApiProperty({
    example: 'Passenger cancelled 1 seat before departure',
    maxLength: 500,
    description: 'Reason for refund.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    example: 'Transferred via wallet to passenger mobile number',
    maxLength: 500,
    description: 'Additional refund notes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AdminFailPaymentDto {
  @ApiProperty({
    example:
      'Transaction reference not found in merchant statement after 24 hours',
    maxLength: 500,
    description: 'Reason for marking payment as failed.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    example: 'Attempted to contact passenger twice with no reply',
    maxLength: 500,
    description: 'Additional notes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
