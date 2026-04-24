import { IsMongoId } from 'class-validator';

export class MessageIdParamDto {
  @IsMongoId()
  id!: string;

  @IsMongoId()
  messageId!: string;
}
