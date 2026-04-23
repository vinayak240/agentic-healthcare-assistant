import { Injectable } from '@nestjs/common';
import type { HydratedDocument, Types } from 'mongoose';
import { AgentService } from '../agent/agent.service';
import type { AgentEvent } from '../agent/agent.types';
import {
  AppError,
  AppException,
  createAppException,
  normalizeError,
  toEventErrorPayload,
} from '../common/errors/app-error';
import { ConversationsRepository } from '../dal/repositories/conversations.repository';
import { MessagesRepository } from '../dal/repositories/messages.repository';
import { RunsRepository } from '../dal/repositories/runs.repository';
import { UsersRepository } from '../dal/repositories/users.repository';
import type { Conversation } from '../dal/schemas/conversation.schema';
import type { Message } from '../dal/schemas/message.schema';
import type { Run } from '../dal/schemas/run.schema';
import { AppEventEmitter } from '../events/emitter/event.emitter';
import { createSseEvent } from './sse-event.helper';
import type { ChatRequest, ChatResponse, StructuredSseEvent } from './chat.types';

interface PreparedChatRequest {
  conversation: HydratedDocument<Conversation> | null;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly runsRepository: RunsRepository,
    private readonly messagesRepository: MessagesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly agentService: AgentService,
    private readonly appEventEmitter: AppEventEmitter,
  ) {}

  async prepareChatRequest(request: ChatRequest): Promise<PreparedChatRequest> {
    await this.ensureUserExists(request.userId);
    this.agentService.assertReady();

    return {
      conversation: request.conversationId
        ? await this.findConversationForUser(request.conversationId, request.userId)
        : null,
    };
  }

  async createChat(
    request: ChatRequest,
    onEvent?: (event: StructuredSseEvent) => Promise<void> | void,
    prepared?: PreparedChatRequest,
  ): Promise<ChatResponse> {
    const preparedRequest = prepared ?? (await this.prepareChatRequest(request));
    const startedAt = new Date();
    const conversation =
      preparedRequest.conversation ?? (await this.createConversation(request, startedAt));
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

    void this.appEventEmitter.emitEvent({
      userId: request.userId,
      conversationId: this.getDocumentId(conversation),
      runId: this.getDocumentId(run),
      source: 'system',
      type: 'run_started',
      payload: {
        input: request.message,
      },
    });
    void this.appEventEmitter.emitEvent({
      userId: request.userId,
      conversationId: this.getDocumentId(conversation),
      runId: this.getDocumentId(run),
      source: 'user',
      type: 'message_created',
      payload: {
        input: request.message,
        toolData: {
          role: 'user',
        },
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
    const warnings: AppError[] = [];

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

        if (agentEvent.type === 'run.warning') {
          warnings.push(agentEvent.error);
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

      void this.appEventEmitter.emitEvent({
        userId: request.userId,
        conversationId: this.getDocumentId(conversation),
        runId: this.getDocumentId(run),
        source: 'agent',
        type: 'message_created',
        payload: {
          output: finalAssistantText,
          toolData: {
            role: 'assistant',
          },
        },
      });

      if (totalTokens !== null) {
        void this.appEventEmitter.emitEvent({
          userId: request.userId,
          conversationId: this.getDocumentId(conversation),
          runId: this.getDocumentId(run),
          source: 'system',
          type: 'usage_final',
          payload: {
            totalTokens,
          },
        });
      }

      void this.appEventEmitter.emitEvent({
        userId: request.userId,
        conversationId: this.getDocumentId(conversation),
        runId: this.getDocumentId(run),
        source: 'system',
        type: 'run_completed',
        payload: {
          output: finalAssistantText,
        },
      });

      const response = {
        conversation: this.serializeConversation(conversation, endedAt),
        run: this.serializeCompletedRun(completedRun ?? run, endedAt),
        assistantMessage: this.serializeAssistantMessage(assistantMessage),
        warnings,
        usage: null,
      } satisfies ChatResponse;

      await onEvent?.(
        createSseEvent(this.getDocumentId(run), 'run.completed', {
          status: 'completed',
          conversationId: this.getDocumentId(conversation),
        }),
      );

      return response;
    } catch (error) {
      const appError = normalizeError(error, {
        stage: 'system',
        fallbackCode: 'CHAT_INTERNAL_ERROR',
      });
      const endedAt = new Date();

      await this.runsRepository.updateById(this.getDocumentId(run), {
        $set: {
          status: 'failed',
          endedAt,
        },
      });

      void this.appEventEmitter.emitEvent({
        userId: request.userId,
        conversationId: this.getDocumentId(conversation),
        runId: this.getDocumentId(run),
        source: 'system',
        type: 'run_failed',
        payload: toEventErrorPayload(appError),
      });

      await onEvent?.(
        createSseEvent(this.getDocumentId(run), 'run.failed', {
          error: appError,
        }),
      );
      await onEvent?.(
        createSseEvent(this.getDocumentId(run), 'error', {
          error: appError,
          message: appError.message,
        }),
      );

      throw new AppException(appError);
    }
  }

  private async createConversation(
    request: ChatRequest,
    timestamp: Date,
  ): Promise<HydratedDocument<Conversation>> {
    return this.conversationsRepository.create({
      userId: this.toObjectId(request.userId),
      title: request.title?.trim() || this.deriveConversationTitle(request.message),
      lastMessageAt: timestamp,
    });
  }

  private async findConversationForUser(
    conversationId: string,
    userId: string,
  ): Promise<HydratedDocument<Conversation>> {
    const conversation = await this.conversationsRepository.findById(conversationId);

    if (!conversation || String(conversation.userId) !== userId) {
      throw createAppException('CONVERSATION_NOT_FOUND');
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
      case 'run.warning':
        return createSseEvent(runId, event.type, {
          error: event.error,
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
      throw createAppException('USER_NOT_FOUND');
    }
  }
}
