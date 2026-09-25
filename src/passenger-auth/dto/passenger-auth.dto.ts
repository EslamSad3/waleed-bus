import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Accepted raw forms: 01…, +201…, 00201… (service normalizes to 01XXXXXXXXX). */
export const PHONE_PATTERN = '^(?:\\+20|0020|0)?1\\d{9}$';

function Trimmed() {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

export class RegisterDto {
  @ApiProperty({ example: 'Ahmed', maxLength: 255 })
  @IsString()
  @Length(1, 255)
  @Trimmed()
  name!: string;

  @ApiProperty({ example: '01000000000', maxLength: 20 })
  @IsString()
  @MaxLength(20)
  @Matches(new RegExp(PHONE_PATTERN), {
    message: 'phoneNumber must be a valid Egyptian mobile number',
  })
  @Trimmed()
  phoneNumber!: string;

  @ApiProperty({ format: 'password', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class SendOtpDto {
  @ApiProperty({ example: '01000000000', maxLength: 20 })
  @IsString()
  @MaxLength(20)
  @Matches(new RegExp(PHONE_PATTERN), {
    message: 'phoneNumber must be a valid Egyptian mobile number',
  })
  @Trimmed()
  phoneNumber!: string;
}

export class VerifyOtpDto extends SendOtpDto {
  @ApiProperty({ example: '123456', pattern: '^\\d{6}$' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'otp must be 6 digits' })
  otp!: string;
}

export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'Ahmed', maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Trimmed()
  name?: string;

  @ApiPropertyOptional({ example: '01000000001', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(new RegExp(PHONE_PATTERN), {
    message: 'phoneNumber must be a valid Egyptian mobile number',
  })
  @Trimmed()
  phoneNumber?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/p.png',
    maxLength: 1024,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  picture?: string;
}

/** Documentation-only model for GET /me/profile-status. */
export class ProfileStatusDto {
  @ApiProperty({ example: false })
  profileComplete!: boolean;

  @ApiProperty({ example: ['phoneNumber'] })
  missingFields!: string[];

  @ApiProperty({ example: false })
  phoneVerified!: boolean;

  @ApiProperty({ type: String, example: '01000000001', nullable: true })
  pendingPhoneNumber!: string | null;

  @ApiProperty({ type: Number, example: 60, nullable: true })
  expiresInSeconds!: number | null;

  @ApiProperty({ example: 5, description: 'Display-only seat cap (user override ?? platform default 5). Enforcement is server-side.' })
  effectiveMaxBookingSeats!: number;
}
