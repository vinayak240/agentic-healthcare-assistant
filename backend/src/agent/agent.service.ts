import { Injectable } from '@nestjs/common';
import {
  buildRenderingWarning,
  isAppError,
  toEventErrorPayload,
} from '../common/errors/app-error';
import { OpenAiService } from '../clients/openai/openai.service';
import { MessagesRepository } from '../dal/repositories/messages.repository';
import { AppEventEmitter } from '../events/emitter/event.emitter';
import { ToolService } from '../tool/tool.service';
import { runAgent } from './run-agent';
import type {
  AgentEvent,
  AgentMessage,
  AgentRunContext,
  AgentTool,
  RunAgentResult,
} from './agent.types';

@Injectable()
export class AgentService {
  constructor(
    private readonly toolService: ToolService,
    private readonly openAiService: OpenAiService,
    private readonly messagesRepository: MessagesRepository,
    private readonly appEventEmitter: AppEventEmitter,
  ) {}

  assertReady(): void {
    this.openAiService.assertConfigured();
  }

  async *streamResponse(context: AgentRunContext): AsyncGenerator<AgentEvent> {
    const history = await this.loadConversationHistory(context);
    const tools = this.buildTools(context);
    let llmTotalTokens = 0;
    // `runAgent()` is a promise-based loop, but the chat layer expects streaming events
    // while that loop is still running. This in-memory queue bridges those two models:
    // the loop pushes tool lifecycle events into the queue, and this generator yields them
    // out immediately to the SSE layer.
    const queue: AgentEvent[] = [];
    let notify: (() => void) | null = null;
    let result: RunAgentResult | null = null;
    let runError: unknown = null;
    const pushEvent = (event: AgentEvent) => {
      queue.push(event);

      if (notify) {
        notify();
        notify = null;
      }
    };
    const runPromise = runAgent({
      llm: async (prompt) => {
        void this.appEventEmitter.emitEvent({
          userId: context.userId,
          conversationId: context.conversationId,
          runId: context.runId,
          source: 'agent',
          type: 'llm_called',
          payload: {
            input: prompt,
          },
        });
        const response = await this.openAiService.createJsonResponse(prompt);
        llmTotalTokens += response.totalTokens;
        return response.content;
      },
      tools,
      history,
      userMessage: context.message,
      stream: async (chunk) => {
        const event = this.parseAgentStreamChunk(chunk);

        if (event) {
          await this.persistAgentEvent(context, event);
          pushEvent(event);
        }
      },
    })
      .then((value) => {
        result = value;
      })
      .catch((error) => {
        runError = error;
      })
      .finally(() => {
        if (notify) {
          notify();
          notify = null;
        }
      });

    // Keep yielding queued tool events until the loop finishes and the queue is drained.
    while (!result || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });

        if (runError) {
          break;
        }

        continue;
      }

      yield queue.shift() as AgentEvent;
    }

    await runPromise;

    if (runError) {
      throw runError;
    }

    if (!result) {
      throw new Error('Agent did not produce a result');
    }

    const finalResult: RunAgentResult = result;
    // The loop only decides what the final answer should contain. The actual user-facing
    // prose is rendered in a second OpenAI call so that only the final answer is streamed
    // token-by-token to the client.
    const finalPrompt = this.buildFinalAnswerPrompt({
      history,
      userMessage: context.message,
      answerBrief: finalResult.finalAnswerBrief,
      toolObservations: finalResult.toolObservations,
    });
    let finalMessage = '';
    let streamedTokens = 0;

    try {
      void this.appEventEmitter.emitEvent({
        userId: context.userId,
        conversationId: context.conversationId,
        runId: context.runId,
        source: 'agent',
        type: 'llm_called',
        payload: {
          input: finalPrompt,
        },
      });
      const stream = this.openAiService.streamTextResponse(finalPrompt);

      while (true) {
        const next = await stream.next();

        if (next.done) {
          finalMessage = next.value.content || finalMessage.trim();
          streamedTokens = next.value.totalTokens;
          break;
        }

        finalMessage += next.value;

        yield {
          type: 'message.delta',
          delta: next.value,
        };
      }
    } catch (error) {
      const warning = buildRenderingWarning(error);

      yield {
        type: 'run.warning',
        error: warning,
      };

      // If final-answer streaming fails, we still complete the run with the loop's safe
      // brief instead of failing the whole chat request.
      finalMessage = finalResult.finalAnswerBrief;

      for (const delta of this.splitIntoDeltas(finalMessage)) {
        yield {
          type: 'message.delta',
          delta,
        };
      }
    }

    yield {
      type: 'message.completed',
      message: finalMessage,
    };

    yield {
      type: 'usage.final',
      totalTokens: Math.max(32, llmTotalTokens + streamedTokens),
    };
  }

  private buildTools(context: AgentRunContext): AgentTool[] {
    // The agent loop consumes a simple generic tool contract. This adapter keeps the loop
    // decoupled from Nest-specific classes and the registry implementation. Backend-known
    // identifiers stay hidden from the model and are injected only when a tool executes.
    return this.toolService.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: this.stripInternalSchemaFields(tool.inputSchema),
      execute: async (input) =>
        this.toolService.executeTool(tool.name, this.injectInternalToolContext(input, context)),
    }));
  }

  private async loadConversationHistory(context: AgentRunContext): Promise<AgentMessage[]> {
    const messages = await this.messagesRepository.findByConversationId(context.conversationId);
    const historyLimit = this.resolveHistoryLimit();

    return messages
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
  }

  private buildFinalAnswerPrompt(input: {
    history: AgentMessage[];
    userMessage: string;
    answerBrief: string;
    toolObservations: Array<{
      toolName: string;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
    }>;
  }): string {
    return [
      'Write the final assistant response for the user.',
      'Use the brief and tool observations faithfully.',
      'Do not mention internal reasoning or hidden chain-of-thought.',
      '',
      `HISTORY=${JSON.stringify(input.history)}`,
      `USER_MESSAGE=${JSON.stringify(input.userMessage)}`,
      `ANSWER_BRIEF=${JSON.stringify(input.answerBrief)}`,
      `TOOL_OBSERVATIONS=${JSON.stringify(input.toolObservations)}`,
    ].join('\n');
  }

  private parseAgentStreamChunk(chunk: string): AgentEvent | null {
    let parsed: unknown;

    try {
      parsed = JSON.parse(chunk);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;

    // Only tool lifecycle events are emitted by `runAgent()`. Message streaming is handled
    // separately by the final-answer OpenAI stream, so anything else is ignored here.
    if (
      candidate.type === 'tool.call.started' &&
      typeof candidate.toolName === 'string' &&
      candidate.input &&
      typeof candidate.input === 'object' &&
      !Array.isArray(candidate.input)
    ) {
      return {
        type: 'tool.call.started',
        toolName: candidate.toolName,
        input: candidate.input as Record<string, unknown>,
      };
    }

    if (
      candidate.type === 'tool.call.completed' &&
      typeof candidate.toolName === 'string' &&
      candidate.output &&
      typeof candidate.output === 'object' &&
      !Array.isArray(candidate.output)
    ) {
      return {
        type: 'tool.call.completed',
        toolName: candidate.toolName,
        output: candidate.output as Record<string, unknown>,
      };
    }

    return null;
  }

  private stripInternalSchemaFields(
    inputSchema: Record<string, unknown>,
  ): Record<string, unknown> {
    const properties =
      inputSchema.properties &&
      typeof inputSchema.properties === 'object' &&
      !Array.isArray(inputSchema.properties)
        ? { ...(inputSchema.properties as Record<string, unknown>) }
        : undefined;
    const required = Array.isArray(inputSchema.required)
      ? inputSchema.required.filter(
          (value): value is string =>
            typeof value === 'string' && !this.isInternalIdentifierField(value),
        )
      : undefined;

    if (properties) {
      delete properties.userId;
      delete properties.conversationId;
      delete properties.runId;
    }

    return {
      ...inputSchema,
      ...(properties ? { properties } : {}),
      ...(required ? { required } : {}),
    };
  }

  private injectInternalToolContext(
    input: Record<string, unknown>,
    context: AgentRunContext,
  ): Record<string, unknown> {
    return {
      ...input,
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
    };
  }

  private isInternalIdentifierField(value: string): boolean {
    return value === 'userId' || value === 'conversationId' || value === 'runId';
  }

  private splitIntoDeltas(message: string): string[] {
    const words = message.split(' ');
    const deltas: string[] = [];

    for (let index = 0; index < words.length; index += 4) {
      const chunk = words.slice(index, index + 4).join(' ');
      deltas.push(index + 4 < words.length ? `${chunk} ` : chunk);
    }

    return deltas;
  }

  private resolveHistoryLimit(): number {
    const rawValue = Number(process.env.AGENT_HISTORY_CAP);

    if (!Number.isFinite(rawValue) || rawValue < 1) {
      return 10;
    }

    return Math.floor(rawValue);
  }

  private async persistAgentEvent(
    context: AgentRunContext,
    event: Extract<AgentEvent, { type: 'tool.call.started' | 'tool.call.completed' }>,
  ): Promise<void> {
    if (event.type === 'tool.call.started') {
      void this.appEventEmitter.emitEvent({
        userId: context.userId,
        conversationId: context.conversationId,
        runId: context.runId,
        source: 'agent',
        type: 'tool_called',
        payload: {
          toolName: event.toolName,
          toolData: event.input,
        },
      });

      return;
    }

    void this.appEventEmitter.emitEvent({
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
      source: 'agent',
      type: 'tool_result',
      payload: {
        toolName: event.toolName,
        toolData: event.output,
        ...(isAppError(event.output.appError)
          ? toEventErrorPayload(event.output.appError)
          : typeof event.output.error === 'string'
            ? {
                error: event.output.error,
              }
            : {}),
      },
    });
  }
}
