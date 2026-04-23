import { Body, Controller, Post } from '@nestjs/common';
import { ChatService } from '../../chat/chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  createChatMessage(@Body() body: { content?: string }) {
    const message = this.chatService.createMessage(body?.content ?? 'Hello');

    return {
      message: 'Dummy chat response',
      data: message,
    };
  }
}
