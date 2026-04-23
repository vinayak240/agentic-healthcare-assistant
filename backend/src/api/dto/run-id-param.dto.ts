import { IsNotEmpty, IsString } from 'class-validator';

export class RunIdParamDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}
