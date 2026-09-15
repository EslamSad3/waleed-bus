import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ADMIN_REPORT_RESOLUTIONS = ['RESOLVED', 'DISMISSED'] as const;

export class AdminResolveReportDto {
  @ApiProperty({
    enum: [...ADMIN_REPORT_RESOLUTIONS],
    example: 'RESOLVED',
    description: 'Target report status.',
  })
  @IsString()
  @IsIn([...ADMIN_REPORT_RESOLUTIONS])
  status!: string;

  @ApiProperty({
    example:
      'Contacted passenger and clarified station pickup punctuality rule; incident resolved.',
    minLength: 5,
    maxLength: 2000,
    description: 'Mandatory resolution explanation.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(2000)
  resolutionNote!: string;
}
