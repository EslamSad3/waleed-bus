import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/** Documentation-only response model for a bus row. */
export class BusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  fleetId!: string;

  @ApiProperty({ example: 'BUS-A-001', minLength: 1, maxLength: 50 })
  registrationNumber!: string;

  @ApiPropertyOptional({ example: 'ABC-1234', maxLength: 50 })
  plateNumber?: string;

  @ApiProperty({ example: 45, minimum: 1, maximum: 300 })
  capacity!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class CreateBusDto {
  @ApiProperty({
    example: 'BUS-A-002',
    minLength: 1,
    maxLength: 50,
    description: 'Unique within the fleet (409 otherwise).',
  })
  @IsString()
  @Length(1, 50)
  registrationNumber!: string;

  @ApiPropertyOptional({ example: 'ABC-1234', maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  plateNumber?: string;

  @ApiProperty({ example: 45, minimum: 1, maximum: 300 })
  @IsInt()
  @Min(1)
  @Max(300)
  capacity!: number;
}

export class UpdateBusDto {
  @ApiPropertyOptional({ example: 'ABC-1234', maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  plateNumber?: string;

  @ApiPropertyOptional({ example: 45, minimum: 1, maximum: 300 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  capacity?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
