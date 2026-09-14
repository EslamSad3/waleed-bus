import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/** Documentation-only response model for a permission row. */
export class PermissionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    example: 'buses.read',
    description: 'resource.action key consumed by @RequirePermission.',
  })
  key!: string;

  @ApiProperty({ example: 'buses' })
  resource!: string;

  @ApiProperty({ example: 'read' })
  action!: string;

  @ApiPropertyOptional({
    example: 'List/read buses in the fleet',
    nullable: true,
  })
  description?: string;

  @ApiProperty({ example: true })
  isSystem!: boolean;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class CreatePermissionDto {
  @ApiProperty({
    example: 'buses.read',
    pattern: '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$',
    minLength: 3,
    maxLength: 100,
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, {
    message: 'key must be resource.action (kebab/snake case)',
  })
  @Length(3, 100)
  key!: string;

  @ApiProperty({ example: 'buses', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  resource!: string;

  @ApiProperty({ example: 'read', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  action!: string;

  @ApiPropertyOptional({
    example: 'List/read buses in the fleet',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;
}

export class UpdatePermissionDto {
  @ApiPropertyOptional({
    example: 'List/read buses in the fleet',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
