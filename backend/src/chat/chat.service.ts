import { Injectable, Optional } from '@nestjs/common';
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
import { LoggerService } from '../logger/logger.service';
import { createSseEvent } from './sse-event.helper';
import type { ChatRequest, ChatResponse, StructuredSseEvent } from './chat.types';

interface PreparedChatRequest {
  conversation: HydratedDocument<Conversation> | null;
}

@Injectable()
export class ChatService {
  private readonly logger: LoggerService;

  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly runsRepository: RunsRepository,
    private readonly messagesRepository: MessagesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly agentService: AgentService,
    private readonly appEventEmitter: AppEventEmitter,
    @Optional() logger: LoggerService = new LoggerService(),
  ) {
    this.logger = logger.child({
      component: ChatService.name,
    });
  }

  async prepareChatRequest(request: ChatRequest): Promise<PreparedChatRequest> {
    const startedAt = Date.now();

    this.logger.info('chat.request.prepare.started', {
      stage: 'preflight',
      operation: 'prepare_chat_request',
      status: 'started',
      userId: request.userId,
      conversationId: request.conversationId ?? null,
    });

    try {
      await this.ensureUserExists(request.userId);
      this.agentService.assertReady();

      const prepared = {
        conversation: request.conversationId
          ? await this.findConversationForUser(request.conversationId, request.userId)
          : null,
      };

      this.logger.info('chat.request.prepare.completed', {
        stage: 'preflight',
        operation: 'prepare_chat_request',
        status: 'completed',
        userId: request.userId,
        conversationId: prepared.conversation
          ? this.getDocumentId(prepared.conversation)
          : request.conversationId ?? null,
        durationMs: Date.now() - startedAt,
        conversationStatus: prepared.conversation ? 'reused' : 'new',
      });

      return prepared;
    } catch (error) {
      const appError = normalizeError(error, {
        stage: 'preflight',
        fallbackCode: 'CHAT_INTERNAL_ERROR',
      });

      this.logger.error('chat.request.prepare.failed', {
        stage: appError.stage,
        operation: 'prepare_chat_request',
        status: 'failed',
        userId: request.userId,
        conversationId: request.conversationId ?? null,
        durationMs: Date.now() - startedAt,
        errorCode: appError.code,
      });

      throw error;
    }
  }

  async createChat(
    request: ChatRequest,
    onEvent?: (event: StructuredSseEvent) => Promise<void> | void,
    prepared?: PreparedChatRequest,
  ): Promise<ChatResponse> {
    const preparedRequest = prepared ?? (await this.prepareChatRequest(request));
    const requestStartedAt = Date.now();
    const startedAt = new Date();
    const conversation =
      preparedRequest.conversation ?? (await this.createConversation(request, startedAt));
    const conversationId = this.getDocumentId(conversation);

    this.logger.info('chat.run.bootstrap', {
      stage: 'system',
      operation: 'create_chat',
      status: 'started',
      userId: request.userId,
      conversationId,
      conversationStatus: preparedRequest.conversation ? 'reused' : 'created',
    });
    const run = await this.runsRepository.create({
      userId: this.toObjectId(request.userId),
      conversationId: this.toObjectId(conversationId),
      status: 'running',
      startedAt,
      endedAt: null,
    });
    const runId = this.getDocumentId(run);

    this.logger.info('chat.run.started', {
      stage: 'system',
      operation: 'run_create',
      status: 'started',
      userId: request.userId,
      conversationId,
      runId,
    });

    const userMessage = await this.messagesRepository.create({
      userId: this.toObjectId(request.userId),
      conversationId: this.toObjectId(conversationId),
      runId: this.toObjectId(runId),
      role: 'user',
      content: {
        text: request.message,
      },
    });

    this.logger.debug('chat.message.user.persisted', {
      stage: 'system',
      operation: 'persist_user_message',
      status: 'completed',
      userId: request.userId,
      conversationId,
      runId,
      messageLength: request.message.length,
    });

    await this.conversationsRepository.updateById(conversationId, {
      $set: {
        lastMessageAt: startedAt,
      },
    });

    void this.appEventEmitter.emitEvent({
      userId: request.userId,
      conversationId,
      runId,
      source: 'system',
      type: 'run_started',
      payload: {
        input: request.message,
      },
    });
    void this.appEventEmitter.emitEvent({
      userId: request.userId,
      conversationId,
      runId,
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
      createSseEvent(runId, 'run.started', {
        conversationId,
        status: 'running',
        userMessageId: this.getDocumentId(userMessage),
      }),
    );

    let assistantText = '';
    let completedMessage: string | null = null;
    let totalTokens: number | null = null;
    let generatedConversationTitle: string | null = null;
    const warnings: AppError[] = [];

    try {
      this.logger.info('chat.agent.stream.started', {
        stage: 'reasoning',
        operation: 'agent_stream',
        status: 'started',
        userId: request.userId,
        conversationId,
        runId,
      });

      for await (const agentEvent of this.agentService.streamResponse({
        userId: request.userId,
        conversationId,
        runId,
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

        if (agentEvent.type === 'conversation.title.generated') {
          generatedConversationTitle = this.normalizeConversationTitle(agentEvent.title) ?? null;
        }

        if (agentEvent.type === 'run.warning') {
          warnings.push(agentEvent.error);
          this.logger.warn('chat.agent.warning', {
            stage: agentEvent.error.stage,
            operation: 'agent_stream',
            status: 'warning',
            userId: request.userId,
            conversationId,
            runId,
            errorCode: agentEvent.error.code,
          });
        }

        await onEvent?.(this.mapAgentEventToSseEvent(runId, agentEvent));
      }

      const finalAssistantText = (completedMessage ?? assistantText).trim();
      const assistantMessage = await this.messagesRepository.create({
        userId: this.toObjectId(request.userId),
        conversationId: this.toObjectId(this.getDocumentId(conversation)),
        runId: this.toObjectId(this.getDocumentId(run)),
        role: 'assistant',
        content: {
          text: finalAssistantText,
          metadata: {
            modelName: this.resolveModelName(),
            ...(totalTokens !== null ? { totalTokens } : {}),
          },
        },
      });

      const endedAt = new Date();
      const completedRun = await this.runsRepository.updateById(runId, {
        $set: {
          status: 'completed',
          endedAt,
        },
      });

      await this.conversationsRepository.updateById(conversationId, {
        $set: {
          lastMessageAt: endedAt,
        },
      });

      const conversationTitleOverride =
        !preparedRequest.conversation && !request.title?.trim()
          ? generatedConversationTitle ?? undefined
          : undefined;

      if (conversationTitleOverride) {
        await this.conversationsRepository.updateById(conversationId, {
          $set: {
            title: conversationTitleOverride,
          },
        });
      }

      void this.appEventEmitter.emitEvent({
        userId: request.userId,
        conversationId,
        runId,
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
          conversationId,
          runId,
          source: 'system',
          type: 'usage_final',
          payload: {
            totalTokens,
            modelName: this.resolveModelName(),
          },
        });
      }

      void this.appEventEmitter.emitEvent({
        userId: request.userId,
        conversationId,
        runId,
        source: 'system',
        type: 'run_completed',
        payload: {
          output: finalAssistantText,
        },
      });

      this.logger.info('chat.run.completed', {
        stage: 'system',
        operation: 'create_chat',
        status: 'completed',
        userId: request.userId,
        conversationId,
        runId,
        durationMs: Date.now() - requestStartedAt,
        warningCount: warnings.length,
        totalTokens,
        assistantMessageLength: finalAssistantText.length,
      });

      const response = {
        conversation: this.serializeConversation(
          conversation,
          endedAt,
          conversationTitleOverride,
        ),
        run: this.serializeCompletedRun(completedRun ?? run, endedAt),
        assistantMessage: this.serializeAssistantMessage(assistantMessage),
        warnings,
        usage: null,
      } satisfies ChatResponse;

      await onEvent?.(
        createSseEvent(runId, 'run.completed', {
          status: 'completed',
          conversationId,
          assistantMessageId: this.getDocumentId(assistantMessage),
          createdAt: assistantMessage.cudFoil.createdAt?.toISOString() ?? endedAt.toISOString(),
          metadata: assistantMessage.content.metadata ?? undefined,
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
        conversationId,
        runId,
        source: 'system',
        type: 'run_failed',
        payload: toEventErrorPayload(appError),
      });

      this.logger.error('chat.run.failed', {
        stage: appError.stage,
        operation: 'create_chat',
        status: 'failed',
        userId: request.userId,
        conversationId,
        runId,
        durationMs: Date.now() - requestStartedAt,
        errorCode: appError.code,
      });

      await onEvent?.(
        createSseEvent(runId, 'run.failed', {
          error: appError,
        }),
      );
      await onEvent?.(
        createSseEvent(runId, 'error', {
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

  private normalizeConversationTitle(value: string): string | undefined {
    const trimmed = value.trim().replace(/^["'`]+|["'`]+$/g, '').trim();

    if (!trimmed || trimmed.length > 60) {
      return undefined;
    }

    const words = trimmed.split(/\s+/).filter(Boolean);

    if (words.length === 0 || words.length > 6) {
      return undefined;
    }

    return words.join(' ');
  }

  private resolveModelName(): string {
    return process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
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
      case 'reasoning.delta':
        return createSseEvent(runId, event.type, {
          delta: event.delta,
        });
      case 'message.completed':
        return createSseEvent(runId, event.type, {
          message: event.message,
        });
      case 'conversation.title.generated':
        return createSseEvent(runId, event.type, {
          title: event.title,
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
          modelName: this.resolveModelName(),
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
    titleOverride?: string,
  ): ChatResponse['conversation'] {
    return {
      id: this.getDocumentId(conversation),
      userId: String(conversation.userId),
      title: titleOverride ?? conversation.title,
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
      metadata: message.content.metadata ?? undefined,
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
