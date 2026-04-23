import { IsNotEmpty, IsString } from 'class-validator';
import { PaginationDto } from './pagination.dto';

export class ConversationListQueryDto extends PaginationDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}
