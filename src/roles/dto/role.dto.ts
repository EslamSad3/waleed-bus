import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/** Documentation-only response model for a role row. */
export class RoleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Fleet Manager' })
  name!: string;

  @ApiProperty({
    example: 'fleet-manager',
    description: 'Kebab-case unique slug used in JWT app_role and role APIs.',
  })
  slug!: string;

  @ApiPropertyOptional({ example: 'Manages fleet operations', nullable: true })
  description?: string;

  @ApiProperty({
    example: false,
    description: 'System roles are protected from mutation/deletion.',
  })
  isSystem!: boolean;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class CreateRoleDto {
  @ApiProperty({ example: 'Fleet Manager', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({
    example: 'fleet-manager',
    pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
    minLength: 2,
    maxLength: 100,
    description: 'Kebab-case unique slug (409 otherwise).',
  })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' })
  @Length(2, 100)
  slug!: string;

  @ApiPropertyOptional({ example: 'Manages fleet operations', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['buses.read', 'trips.update'],
    description: 'Initial permission keys (unknown keys → 409).',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissionKeys?: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({
    example: 'Fleet Manager',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ example: 'Manages fleet operations', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetRolePermissionsDto {
  @ApiProperty({
    type: [String],
    example: ['buses.read', 'trips.update'],
    description:
      'Full replacement permission set (atomic; unknown keys → 409).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Type(() => String)
  permissionKeys!: string[];
}
