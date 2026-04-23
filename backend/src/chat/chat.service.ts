import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { HydratedDocument, Types } from 'mongoose';
import { AgentService } from '../agent/agent.service';
import type { AgentEvent } from '../agent/agent.types';
import { ConversationsRepository } from '../dal/repositories/conversations.repository';
import { MessagesRepository } from '../dal/repositories/messages.repository';
import { RunsRepository } from '../dal/repositories/runs.repository';
import { UsagesRepository } from '../dal/repositories/usages.repository';
import { UsersRepository } from '../dal/repositories/users.repository';
import type { Conversation } from '../dal/schemas/conversation.schema';
import type { Message } from '../dal/schemas/message.schema';
import type { Run } from '../dal/schemas/run.schema';
import { createSseEvent } from './sse-event.helper';
import type { ChatRequest, ChatResponse, StructuredSseEvent } from './chat.types';

@Injectable()
export class ChatService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly runsRepository: RunsRepository,
    private readonly messagesRepository: MessagesRepository,
    private readonly usagesRepository: UsagesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly agentService: AgentService,
  ) {}

  async createChat(
    request: ChatRequest,
    onEvent?: (event: StructuredSseEvent) => Promise<void> | void,
  ): Promise<ChatResponse> {
    const startedAt = new Date();
    await this.ensureUserExists(request.userId);
    const conversation = await this.resolveConversation(request, startedAt);
    const run = await this.runsRepository.create({
      userId: this.toObjectId(request.userId),
      conversationId: this.toObjectId(this.getDocumentId(conversation)),
      status: 'running',
      startedAt,
      endedAt: null,
    });

    await this.messagesRepository.create({
      userId: this.toObjectId(request.userId),
      conversationId: this.toObjectId(this.getDocumentId(conversation)),
      runId: this.toObjectId(this.getDocumentId(run)),
      role: 'user',
      content: {
        text: request.message,
      },
    });

    await this.conversationsRepository.updateById(this.getDocumentId(conversation), {
      $set: {
        lastMessageAt: startedAt,
      },
    });

    await onEvent?.(
      createSseEvent(this.getDocumentId(run), 'run.started', {
        conversationId: this.getDocumentId(conversation),
        status: 'running',
      }),
    );

    let assistantText = '';
    let completedMessage: string | null = null;
    let totalTokens: number | null = null;

    try {
      for await (const agentEvent of this.agentService.streamResponse({
        userId: request.userId,
        conversationId: this.getDocumentId(conversation),
        runId: this.getDocumentId(run),
        message: request.message,
      })) {
        if (agentEvent.type === 'message.delta') {
          assistantText += agentEvent.delta;
        }

        if (agentEvent.type === 'message.completed') {
          completedMessage = agentEvent.message;
        }

        if (agentEvent.type === 'usage.final') {
          totalTokens = agentEvent.totalTokens;
        }

        await onEvent?.(this.mapAgentEventToSseEvent(this.getDocumentId(run), agentEvent));
      }

      const finalAssistantText = (completedMessage ?? assistantText).trim();
      const assistantMessage = await this.messagesRepository.create({
        userId: this.toObjectId(request.userId),
        conversationId: this.toObjectId(this.getDocumentId(conversation)),
        runId: this.toObjectId(this.getDocumentId(run)),
        role: 'assistant',
        content: {
          text: finalAssistantText,
        },
      });

      if (totalTokens !== null) {
        await this.usagesRepository.create({
          userId: this.toObjectId(request.userId),
          conversationId: this.toObjectId(this.getDocumentId(conversation)),
          runId: this.toObjectId(this.getDocumentId(run)),
          totalTokens,
        });
      }

      const endedAt = new Date();
      const completedRun = await this.runsRepository.updateById(this.getDocumentId(run), {
        $set: {
          status: 'completed',
          endedAt,
        },
      });

      await this.conversationsRepository.updateById(this.getDocumentId(conversation), {
        $set: {
          lastMessageAt: endedAt,
        },
      });

      const response = {
        conversation: this.serializeConversation(conversation, endedAt),
        run: this.serializeCompletedRun(completedRun ?? run, endedAt),
        assistantMessage: this.serializeAssistantMessage(assistantMessage),
        usage: totalTokens === null ? null : { totalTokens },
      } satisfies ChatResponse;

      await onEvent?.(
        createSseEvent(this.getDocumentId(run), 'run.completed', {
          status: 'completed',
          conversationId: this.getDocumentId(conversation),
        }),
      );

      return response;
    } catch (error) {
      const endedAt = new Date();
      await this.runsRepository.updateById(this.getDocumentId(run), {
        $set: {
          status: 'failed',
          endedAt,
        },
      });

      await onEvent?.(
        createSseEvent(this.getDocumentId(run), 'error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );

      throw new InternalServerErrorException('Chat execution failed');
    }
  }

  private async resolveConversation(
    request: ChatRequest,
    timestamp: Date,
  ): Promise<HydratedDocument<Conversation>> {
    if (!request.conversationId) {
      return this.conversationsRepository.create({
        userId: this.toObjectId(request.userId),
        title: request.title?.trim() || this.deriveConversationTitle(request.message),
        lastMessageAt: timestamp,
      });
    }

    const conversation = await this.conversationsRepository.findById(request.conversationId);

    if (!conversation || String(conversation.userId) !== request.userId) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  private deriveConversationTitle(message: string): string {
    const trimmed = message.trim();

    if (trimmed.length <= 60) {
      return trimmed;
    }

    return `${trimmed.slice(0, 57)}...`;
  }

  private mapAgentEventToSseEvent(
    runId: string,
    event: AgentEvent,
  ): StructuredSseEvent<Record<string, unknown>> {
    switch (event.type) {
      case 'message.delta':
        return createSseEvent(runId, event.type, {
          delta: event.delta,
        });
      case 'message.completed':
        return createSseEvent(runId, event.type, {
          message: event.message,
        });
      case 'tool.call.started':
        return createSseEvent(runId, event.type, {
          toolName: event.toolName,
          input: event.input,
        });
      case 'tool.call.completed':
        return createSseEvent(runId, event.type, {
          toolName: event.toolName,
          output: event.output,
        });
      case 'usage.final':
        return createSseEvent(runId, event.type, {
          totalTokens: event.totalTokens,
        });
    }
  }

  private serializeConversation(
    conversation: HydratedDocument<Conversation>,
    lastMessageAt: Date,
  ): ChatResponse['conversation'] {
    return {
      id: this.getDocumentId(conversation),
      userId: String(conversation.userId),
      title: conversation.title,
      lastMessageAt: lastMessageAt.toISOString(),
      createdAt: conversation.cudFoil.createdAt?.toISOString() ?? null,
      updatedAt: conversation.cudFoil.updatedAt?.toISOString() ?? null,
    };
  }

  private serializeCompletedRun(
    run: HydratedDocument<Run>,
    endedAt: Date,
  ): ChatResponse['run'] {
    return {
      id: this.getDocumentId(run),
      status: 'completed',
      startedAt: run.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    };
  }

  private serializeAssistantMessage(
    message: HydratedDocument<Message>,
  ): ChatResponse['assistantMessage'] {
    return {
      id: this.getDocumentId(message),
      role: 'assistant',
      text: message.content.text,
      createdAt: message.cudFoil.createdAt?.toISOString() ?? null,
    };
  }

  private getDocumentId(document: { _id: { toString(): string } }): string {
    return document._id.toString();
  }

  private toObjectId(id: string): Types.ObjectId {
    return id as unknown as Types.ObjectId;
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }
}
