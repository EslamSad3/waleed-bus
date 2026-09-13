import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Documentation-only response model for an audit log row. Secrets are never logged. */
export class AuditLogDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  actorUserId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  actorFleetId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  targetUserId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  targetFleetId?: string;

  @ApiProperty({ example: 'user.setGlobalRoles' })
  action!: string;

  @ApiProperty({ example: 'user' })
  resource!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  resourceId?: string;

  @ApiPropertyOptional({
    description: 'Structured, secret-free context (emails, slugs, permission keys…).',
    example: { roleSlugs: ['fleet_owner'] },
    nullable: true,
    additionalProperties: true,
  })
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true })
  ip?: string;

  @ApiPropertyOptional({ nullable: true })
  userAgent?: string;

  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}
