import { IsNotEmpty, IsString } from 'class-validator';

export class UserUsageParamDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}
