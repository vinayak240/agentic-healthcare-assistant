import { IsMongoId, IsOptional } from 'class-validator';

export class ConversationToolEventsQueryDto {
  @IsOptional()
  @IsMongoId()
  runId?: string;
}
