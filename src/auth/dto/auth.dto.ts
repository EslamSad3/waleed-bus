import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@bus.local', format: 'email', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'Passw0rd!123', format: 'password', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

/**
 * Shared login body (PRD #3): `loginType` selects the flow, absent means the
 * legacy email platform login. Passenger phone/provider variants are
 * validated conditionally in this single class so Nest validates the union.
 * FLEET_OWNER/DRIVER select the phone+password fleet flows (spec 003):
 * same phone/password fields, server-side account-type verification.
 */
export class LoginRequestDto {
  @ApiPropertyOptional({ example: 'PASSENGER', enum: ['PASSENGER', 'FLEET_OWNER', 'DRIVER'] })
  @IsOptional()
  @IsIn(['PASSENGER', 'FLEET_OWNER', 'DRIVER'])
  loginType?: string;

  // Legacy email platform login (loginType absent).
  @ApiPropertyOptional({ example: 'admin@bus.local', format: 'email' })
  @ValidateIf((o: LoginRequestDto) => o.loginType === undefined)
  @IsEmail()
  @MaxLength(255)
  email?: string;

  // Shared password field: legacy login, passenger phone login, or
  // FLEET_OWNER/DRIVER phone login (spec 003 — same field, server-side
  // account-type verification).
  @ApiPropertyOptional({ example: 'Passw0rd!123', format: 'password', minLength: 8, maxLength: 128 })
  @ValidateIf((o: LoginRequestDto) => o.loginType === undefined || o.provider === undefined)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  // Phone login (loginType present, no provider): PASSENGER plus the
  // FLEET_OWNER/DRIVER fleet flows (spec 003).
  @ApiPropertyOptional({ example: '01000000000' })
  @ValidateIf((o: LoginRequestDto) => o.loginType !== undefined && o.provider === undefined)
  @IsString()
  @MaxLength(20)
  @Matches(/^(?:\+20|0020|0)?1\d{9}$/, {
    message: 'phone must be a valid Egyptian mobile number',
  })
  phone?: string;

  // Passenger provider login (loginType present, no phone).
  @ApiPropertyOptional({ enum: ['GOOGLE', 'APPLE'] })
  @ValidateIf((o: LoginRequestDto) => o.loginType !== undefined && o.phone === undefined)
  @IsIn(['GOOGLE', 'APPLE'])
  provider?: string;

  @ApiPropertyOptional({ description: 'Provider identity token.' })
  @ValidateIf((o: LoginRequestDto) => o.loginType !== undefined && o.phone === undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  idToken?: string;
}

export class RefreshDto {
  @ApiProperty({
    description: 'The refresh token obtained from login/refresh. Single use — it rotates.',
    example: 'b3BhcXVlLXJlZnJlc2gtdG9rZW4',
    maxLength: 512,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}

/** Documentation-only model for the token pair returned by login/refresh. */
export class LoginResponseDto {
  @ApiProperty({
    description: 'HS256 access JWT carrying {sub, email, app_role, authVersion, sessionId}.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Opaque rotating refresh token (7 days). Present it to /auth/refresh; never store it client-side in localStorage.',
    example: 'b3BhcXVlLXJlZnJlc2gtdG9rZW4',
  })
  refreshToken!: string;
}

/** Documentation-only model mirroring the verified identity returned by /auth/me. */
export class CurrentUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'admin@bus.local', format: 'email', nullable: true })
  email!: string | null;

  @ApiProperty({
    description: 'Global role slug resolved from the database (super_admin priority, "user" fallback).',
    example: 'super_admin',
  })
  appRole!: string;

  @ApiProperty({ description: 'Bumped on security-sensitive changes; stale tokens are rejected.' })
  authVersion!: number;

  @ApiProperty({ format: 'uuid', description: 'Session id — checked against live sessions on every request.' })
  sessionId!: string;
}
