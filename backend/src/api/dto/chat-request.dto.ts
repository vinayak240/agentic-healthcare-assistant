import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  message!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  conversationId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;
}
