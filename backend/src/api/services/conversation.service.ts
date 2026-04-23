import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConversationsRepository } from '../../dal/repositories/conversations.repository';
import type { MessageCursorInput } from '../../dal/repositories/messages.repository';
import { MessagesRepository } from '../../dal/repositories/messages.repository';
import type { Conversation } from '../../dal/schemas/conversation.schema';
import type { Message } from '../../dal/schemas/message.schema';
import type { HydratedDocument } from 'mongoose';

@Injectable()
export class ConversationService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly messagesRepository: MessagesRepository,
  ) {}

  async listConversations(params: { userId: string; limit?: number; cursor?: string }) {
    const limit = params.limit ?? 20;
    const cursor = params.cursor ? this.decodeConversationCursor(params.cursor) : undefined;
    const conversations = await this.conversationsRepository.findPageByUserId({
      userId: params.userId,
      limit: limit + 1,
      cursor,
    });
    const page = conversations.slice(0, limit);
    const nextCursor =
      conversations.length > limit ? this.encodeConversationCursor(page[page.length - 1]) : null;

    return {
      items: page.map((conversation) => this.serializeConversation(conversation)),
      nextCursor,
    };
  }

  async getConversation(id: string) {
    const conversation = await this.conversationsRepository.findById(id);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.serializeConversation(conversation);
  }

  async listMessages(params: { conversationId: string; limit?: number; cursor?: string }) {
    const conversation = await this.conversationsRepository.findById(params.conversationId);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const limit = params.limit ?? 20;
    const cursor = params.cursor ? this.decodeMessageCursor(params.cursor) : undefined;
    const messages = await this.messagesRepository.findPageByConversationId({
      conversationId: params.conversationId,
      limit: limit + 1,
      cursor,
    });
    const page = messages.slice(0, limit);
    const nextCursor =
      messages.length > limit ? this.encodeMessageCursor(page[page.length - 1]) : null;

    return {
      conversationId: params.conversationId,
      items: page.map((message) => this.serializeMessage(message)),
      nextCursor,
    };
  }

  private serializeConversation(conversation: HydratedDocument<Conversation>) {
    return {
      id: conversation._id.toString(),
      userId: String(conversation.userId),
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      createdAt: conversation.cudFoil.createdAt?.toISOString() ?? null,
      updatedAt: conversation.cudFoil.updatedAt?.toISOString() ?? null,
    };
  }

  private serializeMessage(message: HydratedDocument<Message>) {
    return {
      id: message._id.toString(),
      userId: String(message.userId),
      conversationId: String(message.conversationId),
      runId: String(message.runId),
      role: message.role,
      text: message.content.text,
      createdAt: message.cudFoil.createdAt?.toISOString() ?? null,
      updatedAt: message.cudFoil.updatedAt?.toISOString() ?? null,
    };
  }

  private encodeConversationCursor(conversation: HydratedDocument<Conversation>): string {
    return Buffer.from(
      JSON.stringify({
        id: conversation._id.toString(),
        lastMessageAt: conversation.lastMessageAt.toISOString(),
      }),
      'utf8',
    ).toString('base64url');
  }

  private decodeConversationCursor(cursor: string): { id: string; lastMessageAt: Date } {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        id: string;
        lastMessageAt: string;
      };

      return {
        id: decoded.id,
        lastMessageAt: new Date(decoded.lastMessageAt),
      };
    } catch {
      throw new BadRequestException('Invalid conversation cursor');
    }
  }

  private encodeMessageCursor(message: HydratedDocument<Message>): string {
    return Buffer.from(
      JSON.stringify({
        id: message._id.toString(),
        createdAt: message.cudFoil.createdAt?.toISOString() ?? new Date(0).toISOString(),
      }),
      'utf8',
    ).toString('base64url');
  }

  private decodeMessageCursor(cursor: string): MessageCursorInput {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        id: string;
        createdAt: string;
      };

      return {
        id: decoded.id,
        createdAt: new Date(decoded.createdAt),
      };
    } catch {
      throw new BadRequestException('Invalid message cursor');
    }
  }
}
