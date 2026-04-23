import { IsDateString, IsOptional } from 'class-validator';

export class UsageRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
