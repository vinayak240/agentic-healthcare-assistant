import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatRequestDto } from '../dto';
import { ChatService } from '../../chat/chat.service';
import { formatSseEvent } from '../../chat/sse-event.helper';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  createChatMessage(@Body() body: ChatRequestDto) {
    return this.chatService.createChat(body);
  }

  @Post('stream')
  @HttpCode(HttpStatus.OK)
  async streamChatMessage(@Body() body: ChatRequestDto, @Res() response: Response): Promise<void> {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    try {
      await this.chatService.createChat(body, async (event) => {
        if (!response.writableEnded) {
          response.write(formatSseEvent(event));
        }
      });
    } finally {
      if (!response.writableEnded) {
        response.end();
      }
    }
  }
}
