import { IsNotEmpty, IsString } from 'class-validator';

export class ConversationIdParamDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}
