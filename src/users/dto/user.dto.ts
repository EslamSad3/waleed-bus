import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const;

/** Documentation-only response model mirroring SafeUser (never exposes password hashes). */
export class UserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'owner@fleet.com', format: 'email' })
  email!: string;

  @ApiPropertyOptional({ example: 'Waleed' })
  name?: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ type: Number, 
    example: 8,
    nullable: true,
    description: 'Per-user seat override; null means the platform default (5).',
  })
  maxBookingSeats?: number | null;

  @ApiProperty({
    example: 5,
    description: 'Effective per-booking seat limit (override ?? platform default).',
  })
  effectiveMaxBookingSeats!: number;

  @ApiProperty({
    example: 1,
    description: 'Bumped on security-sensitive changes; stale tokens rejected.',
  })
  authVersion!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** Documentation-only model for an eligible promotion-target option (GET /users/target-options). */
export class TargetOptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  // NOTE: `type: String` is load-bearing — without it the OpenAPI reflection
  // emits `type: object` for `T | null` unions, breaking generated clients.
  @ApiPropertyOptional({ type: String, nullable: true, example: 'Promo A' })
  name?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'a@example.com', format: 'email' })
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '01009990301' })
  phoneNumber?: string | null;
}

/** Validated query for GET /users/target-options (server-side eligible search). */
export class TargetOptionsQueryDto {
  @ApiPropertyOptional({ example: 'Dalia', description: 'Name/email/phone fragment (Arabic supported).' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: 20, description: 'Max options (1-50, default 20).' })
  @IsOptional()
  @IsString()
  limit?: string;
}

/** Documentation-only model for the caller's own memberships (GET /fleets/mine). */
export class MyMembershipDto {
  @ApiProperty({ format: 'uuid' })
  fleetId!: string;

  @ApiProperty({ example: 'Fleet A' })
  fleetName!: string;

  @ApiProperty({
    example: 'fleet-operator',
    description: 'Slug of the role held in this fleet.',
  })
  roleSlug!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;
}

/** Documentation-only response model for a fleet membership row. */
export class FleetMemberDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  fleetId!: string;

  @ApiProperty({ format: 'uuid' })
  roleId!: string;

  @ApiProperty({ enum: [...MEMBER_STATUSES], example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  joinedAt!: Date;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  assignedBy?: string;
}

/** Documentation-only response model for a fleet row. */
export class FleetDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Fleet A' })
  name!: string;

  @ApiProperty({ format: 'uuid' })
  ownerId!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  vipTierId?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class CreateUserDto {
  @ApiProperty({
    example: 'owner@fleet.com',
    format: 'email',
    maxLength: 255,
    description: 'Stored lowercase; duplicates → 409.',
  })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'Passw0rd!123',
    format: 'password',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ example: 'Waleed', maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  name?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['fleet-owner'],
    description:
      'Global role slugs assigned at creation (unknown/inactive slugs → 409).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  globalRoleSlugs?: string[];
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Waleed', maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  name?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Deactivating bumps authVersion and revokes sessions.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: 'Passw0rd!456',
    format: 'password',
    minLength: 8,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ type: Number, 
    example: 8,
    nullable: true,
    description: 'Per-user seat override (must be ≥ 1); null clears back to the platform default (5).',
  })
  @IsOptional()
  @IsInt()
  maxBookingSeats?: number | null;
}

export class SetUserRolesDto {
  @ApiProperty({
    type: [String],
    example: ['fleet-owner'],
    description:
      'Full replacement set of global role slugs. Removing the last active super admin → 409.',
  })
  @IsArray()
  @IsString({ each: true })
  roleSlugs!: string[];
}

export class AddMemberDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Target user — must exist and be active (else 404).',
  })
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/)
  userId!: string;

  @ApiPropertyOptional({
    example: 'fleet-operator',
    description:
      'Role slug within this fleet; roleId takes precedence when both are given.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  roleSlug?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/)
  roleId?: string;

  @ApiPropertyOptional({ enum: [...MEMBER_STATUSES], default: 'ACTIVE' })
  @IsOptional()
  @IsString()
  @Matches(/^(ACTIVE|SUSPENDED|REVOKED)$/)
  status?: string;
}

export class UpdateMemberDto {
  @ApiPropertyOptional({ example: 'fleet-operator' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  roleSlug?: string;

  @ApiPropertyOptional({
    enum: [...MEMBER_STATUSES],
    description:
      'Suspending/revoking takes effect immediately (sessions invalidated).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(ACTIVE|SUSPENDED|REVOKED)$/)
  status?: string;
}

export class CreateFleetDto {
  @ApiProperty({ example: 'Fleet A', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'User id of the fleet owner (must exist and be active).',
  })
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/)
  ownerId!: string;

  @ApiPropertyOptional({
    example: 'fleet-owner',
    description: 'Optional initial ACTIVE membership for the owner.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  ownerRoleSlug?: string;
}

export class UpdateFleetDto {
  @ApiPropertyOptional({ example: 'Fleet A', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
