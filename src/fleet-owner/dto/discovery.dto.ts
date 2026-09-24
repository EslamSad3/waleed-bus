import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class VipTierDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'VIP 1' })
  name!: string;

  @ApiProperty({ example: 1 })
  rank!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;
}

export class CreateVipTierDto {
  @ApiProperty({ example: 'VIP 1', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  rank!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  isActive?: boolean;
}

export class UpdateVipTierDto {
  @ApiPropertyOptional({ example: 'VIP 1' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  rank?: number;

  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean;
}

export class AssignFleetVipDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'VIP tier to assign; null clears the assignment.',
  })
  @IsOptional()
  @IsUUID()
  vipTierId?: string | null;
}

export class FleetOwnerSearchQueryDto {
  @ApiPropertyOptional({ example: 'Halem', description: 'Owner, fleet, or geography fragment (Arabic supported).' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsString()
  limit?: string;
}

export class FleetOwnerSearchItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Halem Fleet' })
  name!: string;

  @ApiPropertyOptional({ example: 'Halem' })
  ownerName!: string | null;

  @ApiPropertyOptional({ type: () => VipTierDto })
  vipTier!: VipTierDto | null;
}
