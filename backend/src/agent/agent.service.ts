import { Injectable, Optional } from '@nestjs/common';
import { normalizeError } from '../common/errors/app-error';
import { OpenAiService } from '../clients/openai/openai.service';
import { MessagesRepository } from '../dal/repositories/messages.repository';
import { AppEventEmitter } from '../events/emitter/event.emitter';
import { LoggerService } from '../logger/logger.service';
import { ToolService } from '../tool/tool.service';
import { runAgent } from './agent.core';
import { callReasoningLlm, streamFinalAnswer } from './agent.llm';
import type {
  AgentEvent,
  AgentMessage,
  AgentRunContext,
  AgentTool,
  RunAgentResult,
} from './agent.types';
import {
  AgentEventQueue,
  buildLocalScopeResponse,
  injectInternalToolContext,
  parseAgentStreamChunk,
  persistAgentEvent,
  resolveHistoryLimit,
  splitIntoDeltas,
  stripInternalSchemaFields,
} from './agent.utils';

@Injectable()
export class AgentService {
  private readonly logger: LoggerService;

  constructor(
    private readonly toolService: ToolService,
    private readonly openAiService: OpenAiService,
    private readonly messagesRepository: MessagesRepository,
    private readonly appEventEmitter: AppEventEmitter,
    @Optional() logger: LoggerService = new LoggerService(),
  ) {
    this.logger = logger.child({
      component: AgentService.name,
    });
  }

  assertReady(): void {
    this.openAiService.assertConfigured();
  }

  async *streamResponse(context: AgentRunContext): AsyncGenerator<AgentEvent> {
    const startedAt = Date.now();
    const scopeResponse = buildLocalScopeResponse(context.message);

    if (scopeResponse) {
      yield* this.streamLocalScopeResponse(context, scopeResponse);
      return;
    }

    const history = await this.loadConversationHistory(context);
    const tools = this.buildTools(context);
    const eventQueue = new AgentEventQueue();
    let llmTotalTokens = 0;
    let result: RunAgentResult | null = null;
    let runError: unknown = null;

    this.logger.info('agent.stream.started', {
      stage: 'reasoning',
      operation: 'stream_response',
      status: 'started',
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
      historyCount: history.length,
      toolCount: tools.length,
    });

    const runPromise = (async () => {
      try {
        result = await this.runReasoningLoop({
          context,
          history,
          tools,
          onTokens: (totalTokens) => {
            llmTotalTokens += totalTokens;
          },
          onEvent: async (event) => {
            await persistAgentEvent({
              context,
              event,
              appEventEmitter: this.appEventEmitter,
              logger: this.logger,
            });
            this.queueAgentEvent(context, eventQueue, event);
          },
        });
      } catch (error) {
        runError = error;
        const appError = normalizeError(error, {
          stage: 'system',
          fallbackCode: 'CHAT_INTERNAL_ERROR',
        });
        this.logger.error('agent.loop.failed', {
          stage: appError.stage,
          operation: 'agent_loop',
          status: 'failed',
          userId: context.userId,
          conversationId: context.conversationId,
          runId: context.runId,
          errorCode: appError.code,
        });
      } finally {
        eventQueue.close();
      }
    })();

    while (!eventQueue.isClosed || eventQueue.hasEvents()) {
      const event = await eventQueue.next();

      if (event) {
        yield event;
      }
    }

    await runPromise;

    if (runError) {
      throw runError;
    }

    if (!result) {
      throw new Error('Agent did not produce a result');
    }

    const finalResult: RunAgentResult = result;
    if (finalResult.conversationTitle) {
      yield {
        type: 'conversation.title.generated',
        title: finalResult.conversationTitle,
      };
    }

    const renderedAnswer = streamFinalAnswer({
      context,
      history,
      answerBrief: finalResult.finalAnswerBrief,
      toolObservations: finalResult.toolObservations,
      openAiService: this.openAiService,
      appEventEmitter: this.appEventEmitter,
      logger: this.logger,
    });
    let finalMessage = '';
    let streamedTokens = 0;

    while (true) {
      const next = await renderedAnswer.next();

      if (next.done) {
        finalMessage = next.value.message;
        streamedTokens = next.value.totalTokens;
        break;
      }

      yield next.value;
    }

    yield {
      type: 'message.completed',
      message: finalMessage,
    };

    yield {
      type: 'usage.final',
      totalTokens: Math.max(32, llmTotalTokens + streamedTokens),
    };

    this.logger.info('agent.stream.completed', {
      stage: 'system',
      operation: 'stream_response',
      status: 'completed',
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
      durationMs: Date.now() - startedAt,
      llmTotalTokens,
      streamedTokens,
      totalTokens: Math.max(32, llmTotalTokens + streamedTokens),
    });
  }

  private async *streamLocalScopeResponse(
    context: AgentRunContext,
    scopeResponse: { kind: 'greeting' | 'out_of_scope'; message: string },
  ): AsyncGenerator<AgentEvent> {
    this.logger.info('agent.scope.local_response', {
      stage: 'preflight',
      operation: 'scope_guard',
      status: 'completed',
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
      responseType: scopeResponse.kind,
    });

    for (const delta of splitIntoDeltas(scopeResponse.message)) {
      yield {
        type: 'message.delta',
        delta,
      };
    }

    yield {
      type: 'message.completed',
      message: scopeResponse.message,
    };

    yield {
      type: 'usage.final',
      totalTokens: 32,
    };
  }

  private async runReasoningLoop(input: {
    context: AgentRunContext;
    history: AgentMessage[];
    tools: AgentTool[];
    onTokens: (totalTokens: number) => void;
    onEvent: (event: AgentEvent) => Promise<void>;
  }): Promise<RunAgentResult> {
    const { context, history, tools, onTokens, onEvent } = input;
    const result = await runAgent({
      llm: async (prompt) => {
        const response = await callReasoningLlm({
          prompt,
          context,
          openAiService: this.openAiService,
          appEventEmitter: this.appEventEmitter,
          logger: this.logger,
        });

        onTokens(response.totalTokens);

        return response.content;
      },
      tools,
      history,
      userMessage: context.message,
      logger: this.logger,
      runContext: {
        userId: context.userId,
        conversationId: context.conversationId,
        runId: context.runId,
      },
      stream: async (chunk) => {
        const event = parseAgentStreamChunk(chunk);

        if (event) {
          await onEvent(event);
        }
      },
    });

    this.logger.info('agent.loop.completed', {
      stage: 'reasoning',
      operation: 'agent_loop',
      status: 'completed',
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
      iterationsUsed: result.iterationsUsed,
      toolObservationCount: result.toolObservations.length,
    });

    return result;
  }

  private queueAgentEvent(
    context: AgentRunContext,
    eventQueue: AgentEventQueue,
    event: AgentEvent,
  ): void {
    this.logger.debug('agent.stream.event.queued', {
      stage: event.type.startsWith('tool') ? 'tool' : 'reasoning',
      operation: 'stream_event',
      status: 'queued',
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
      eventType: event.type,
      ...(event.type === 'tool.call.started' || event.type === 'tool.call.completed'
        ? { toolName: event.toolName }
        : {}),
    });
    eventQueue.push(event);
  }

  private buildTools(context: AgentRunContext): AgentTool[] {
    // The agent loop consumes a simple generic tool contract. This adapter keeps the loop
    // decoupled from Nest-specific classes and the registry implementation. Backend-known
    // identifiers stay hidden from the model and are injected only when a tool executes.
    return this.toolService.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: stripInternalSchemaFields(tool.inputSchema),
      execute: async (input) =>
        this.toolService.executeTool(tool.name, injectInternalToolContext(input, context)),
    }));
  }

  private async loadConversationHistory(context: AgentRunContext): Promise<AgentMessage[]> {
    const messages = await this.messagesRepository.findByConversationId(context.conversationId);
    const historyLimit = resolveHistoryLimit();

    const history = messages
      // The current user message is already persisted before the agent runs, so exclude
      // messages created for the active run to avoid duplicating it in the prompt.
      .filter((message) => String(message.runId) !== context.runId)
      // Keep only the most recent conversation turns so prompts stay bounded as a
      // conversation grows over time.
      .slice(-historyLimit)
      .map((message) => ({
        role: message.role,
        text: message.content.text,
      }));

    this.logger.debug('agent.history.loaded', {
      stage: 'preflight',
      operation: 'load_history',
      status: 'completed',
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
      messageCount: messages.length,
      historyCount: history.length,
      historyLimit,
    });

    return history;
  }
}
