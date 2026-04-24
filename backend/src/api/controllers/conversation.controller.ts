import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import {
  ConversationIdParamDto,
  ConversationListQueryDto,
  ConversationToolEventsQueryDto,
  CreateAppointmentFollowUpDto,
  MessageIdParamDto,
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

  @Get(':id/tool-events')
  listToolEvents(
    @Param() params: ConversationIdParamDto,
    @Query() query: ConversationToolEventsQueryDto,
  ) {
    return this.conversationService.listToolEvents({
      conversationId: params.id,
      runId: query.runId,
    });
  }

  @Delete(':id/messages/:messageId')
  deleteMessage(@Param() params: MessageIdParamDto) {
    return this.conversationService.deleteMessage({
      conversationId: params.id,
      messageId: params.messageId,
    });
  }

  @Post(':id/messages/:messageId/audio')
  createMessageAudio(@Param() params: MessageIdParamDto) {
    return this.conversationService.createMessageAudio({
      conversationId: params.id,
      messageId: params.messageId,
    });
  }

  @Post(':id/appointment-follow-up')
  createAppointmentFollowUp(
    @Param() params: ConversationIdParamDto,
    @Body() body: CreateAppointmentFollowUpDto,
  ) {
    return this.conversationService.createAppointmentFollowUp({
      conversationId: params.id,
      runId: body.runId,
      specialty: body.specialty,
      reason: body.reason,
      doctorName: body.doctorName,
      phone: body.phone,
    });
  }
}
