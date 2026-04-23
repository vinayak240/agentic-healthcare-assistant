import { Injectable } from '@nestjs/common';
import { ChatMessage } from '../interfaces/chat-message.interface';

@Injectable()
export class ChatService {
  private readonly messages: ChatMessage[] = [];

  createMessage(content = 'Hello'): ChatMessage {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    this.messages.push(message);
    return message;
  }

  getHistory(): ChatMessage[] {
    return this.messages;
  }
}
