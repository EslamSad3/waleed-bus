import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateFavoriteDto {
  @ApiProperty({ enum: ['FLEET', 'BUS'], example: 'BUS' })
  @IsString()
  @IsIn(['FLEET', 'BUS'])
  type!: 'FLEET' | 'BUS';

  @ApiPropertyOptional({ format: 'uuid', description: 'Required for FLEET favorites.' })
  @IsOptional()
  @IsUUID()
  fleetId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Required for BUS favorites.' })
  @IsOptional()
  @IsUUID()
  busId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', description: 'Optional boarding stop preference.' })
  @IsOptional()
  @IsUUID()
  boardingStationId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', description: 'Optional landing stop preference.' })
  @IsOptional()
  @IsUUID()
  landingStationId?: string | null;
}

export class UpdateFavoriteDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Set null to clear.' })
  @IsOptional()
  @IsUUID()
  boardingStationId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Set null to clear.' })
  @IsOptional()
  @IsUUID()
  landingStationId?: string | null;
}

export class FavoriteFleetDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Halem Travel' })
  name!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;
}

export class FavoriteBusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fleetId!: string;

  @ApiProperty({ example: 'BUS-A-001' })
  registrationNumber!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ABC-1234' })
  plateNumber!: string | null;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: 'Halem Travel' })
  fleetName!: string;

  @ApiProperty({ example: true })
  fleetActive!: boolean;
}

export class FavoriteStationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Banha Bridge' })
  name!: string;
}

export class FavoriteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['FLEET', 'BUS'] })
  type!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  fleetId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  busId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  boardingStationId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  landingStationId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ type: () => FavoriteFleetDto, nullable: true })
  fleet!: FavoriteFleetDto | null;

  @ApiPropertyOptional({ type: () => FavoriteBusDto, nullable: true })
  bus!: FavoriteBusDto | null;

  @ApiPropertyOptional({ type: () => FavoriteStationDto, nullable: true })
  boardingStation!: FavoriteStationDto | null;

  @ApiPropertyOptional({ type: () => FavoriteStationDto, nullable: true })
  landingStation!: FavoriteStationDto | null;

  @ApiProperty({ example: true, description: 'False when the favorited fleet/bus was disabled after saving.' })
  isTargetActive!: boolean;
}
