import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

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

  @ApiProperty({ example: 'admin@bus.local', format: 'email' })
  email!: string;

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
