import { IsNotEmpty, IsString } from 'class-validator';

export class UserIdParamDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}
