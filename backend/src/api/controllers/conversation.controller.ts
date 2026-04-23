import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ConversationIdParamDto,
  ConversationListQueryDto,
  PaginationDto,
} from '../dto';
import { ConversationService } from '../services';

@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  listConversations(@Query() query: ConversationListQueryDto) {
    return this.conversationService.listConversations(query);
  }

  @Get(':id')
  getConversation(@Param() params: ConversationIdParamDto) {
    return this.conversationService.getConversation(params.id);
  }

  @Get(':id/messages')
  listMessages(@Param() params: ConversationIdParamDto, @Query() query: PaginationDto) {
    return this.conversationService.listMessages({
      conversationId: params.id,
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}
