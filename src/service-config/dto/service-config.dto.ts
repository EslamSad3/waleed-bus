import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ServiceConfigEntryInputDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Omit to create; unknown ids are rejected, never auto-created.' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Contact customer service', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  text!: string;

  @ApiProperty({ enum: ['PHONE', 'WHATSAPP', 'WEBSITE'], example: 'PHONE' })
  @IsString()
  type!: string;

  @ApiProperty({ example: '0111234567' })
  @IsString()
  @Length(1, 500)
  value!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReplaceServiceConfigDto {
  @ApiProperty({ type: [ServiceConfigEntryInputDto], description: 'Full ordered list; array position wins.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceConfigEntryInputDto)
  entries!: ServiceConfigEntryInputDto[];
}

export class ServiceConfigEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Contact customer service' })
  text!: string;

  @ApiProperty({ enum: ['PHONE', 'WHATSAPP', 'WEBSITE'] })
  type!: string;

  @ApiProperty({ example: '0111234567' })
  value!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;
}
