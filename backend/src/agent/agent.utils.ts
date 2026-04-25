import { isAppError, toEventErrorPayload } from '../common/errors/app-error';
import type { AppEventEmitter } from '../events/emitter/event.emitter';
import type { LoggerService } from '../logger/logger.service';
import type { AgentEvent, AgentRunContext } from './agent.types';

export interface LocalScopeResponse {
  kind: 'greeting' | 'out_of_scope';
  message: string;
}

export class AgentEventQueue {
  private readonly queue: AgentEvent[] = [];
  private notify: (() => void) | null = null;
  private closed = false;

  get isClosed(): boolean {
    return this.closed;
  }

  hasEvents(): boolean {
    return this.queue.length > 0;
  }

  push(event: AgentEvent): void {
    this.queue.push(event);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  async next(): Promise<AgentEvent | null> {
    const event = this.queue.shift();

    if (event) {
      return event;
    }

    if (this.closed) {
      return null;
    }

    await new Promise<void>((resolve) => {
      this.notify = resolve;
    });

    return this.queue.shift() ?? null;
  }

  private wake(): void {
    if (this.notify) {
      this.notify();
      this.notify = null;
    }
  }
}

export function buildLocalScopeResponse(message: string): LocalScopeResponse | null {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return {
      kind: 'out_of_scope',
      message:
        "**MediBuddy can help with health questions.**\n\nPlease ask me about symptoms, medications, appointments, allergies, medical history, wellness, or follow-up care.",
    };
  }

  if (isBriefGreeting(normalized)) {
    return {
      kind: 'greeting',
      message:
        "**Hi, I'm MediBuddy.**\n\nI can help with health questions about symptoms, medications, appointments, allergies, medical history, wellness, or follow-up care.",
    };
  }

  if (hasOffTopicIntent(normalized) && !hasHealthContext(normalized)) {
    return {
      kind: 'out_of_scope',
      message:
        '**I can only help with health-related questions.**\n\nPlease ask me about symptoms, medications, appointments, allergies, medical history, wellness, or follow-up care.',
    };
  }

  return null;
}

export function splitIntoDeltas(message: string): string[] {
  const words = message.split(' ');
  const deltas: string[] = [];

  for (let index = 0; index < words.length; index += 4) {
    const chunk = words.slice(index, index + 4).join(' ');
    deltas.push(index + 4 < words.length ? `${chunk} ` : chunk);
  }

  return deltas;
}

export function resolveHistoryLimit(): number {
  const rawValue = Number(process.env.AGENT_HISTORY_CAP);

  if (!Number.isFinite(rawValue) || rawValue < 1) {
    return 10;
  }

  return Math.floor(rawValue);
}

export function parseAgentStreamChunk(chunk: string): AgentEvent | null {
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

  if (
    candidate.type === 'reasoning.delta' &&
    typeof candidate.delta === 'string' &&
    candidate.delta.trim().length > 0
  ) {
    return {
      type: 'reasoning.delta',
      delta: candidate.delta,
    };
  }

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

export function stripInternalSchemaFields(
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
          typeof value === 'string' && !isInternalIdentifierField(value),
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

export function injectInternalToolContext(
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

export async function persistAgentEvent(input: {
  context: AgentRunContext;
  event: AgentEvent;
  appEventEmitter: AppEventEmitter;
  logger: LoggerService;
}): Promise<void> {
  const { context, event, appEventEmitter, logger } = input;

  if (event.type === 'reasoning.delta') {
    void appEventEmitter.emitEvent({
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
      source: 'agent',
      type: 'reasoning_delta',
      payload: {
        text: event.delta,
      },
    });

    return;
  }

  if (event.type !== 'tool.call.started' && event.type !== 'tool.call.completed') {
    return;
  }

  if (event.type === 'tool.call.started') {
    logger.debug('agent.tool.event.started', {
      stage: 'tool',
      operation: 'persist_agent_event',
      status: 'started',
      userId: context.userId,
      conversationId: context.conversationId,
      runId: context.runId,
      toolName: event.toolName,
    });
    void appEventEmitter.emitEvent({
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

  void appEventEmitter.emitEvent({
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

  logger.debug('agent.tool.event.completed', {
    stage: 'tool',
    operation: 'persist_agent_event',
    status: 'completed',
    userId: context.userId,
    conversationId: context.conversationId,
    runId: context.runId,
    toolName: event.toolName,
    hasStructuredError: isAppError(event.output.appError),
  });
}

function isBriefGreeting(message: string): boolean {
  return /^(hi|hello|hey|good morning|good afternoon|good evening|namaste|thanks|thank you)\b/.test(
    message,
  ) && message.split(' ').length <= 4;
}

function hasOffTopicIntent(message: string): boolean {
  return [
    /\b(code|coding|program|programming|script|algorithm|function|class|debug|compile)\b/,
    /\b(hello world|python|javascript|typescript|java|c\+\+|sql|html|css|react|node)\b/,
    /\b(homework|essay|poem|story|song|joke|recipe|travel|movie|game)\b/,
    /\b(stock|investment|tax|contract|lawsuit|legal|finance|crypto)\b/,
    /\b(ignore|forget|bypass|override|jailbreak|reveal|show)\b.*\b(instruction|prompt|rule|system|developer)\b/,
    /\b(write|give|create|generate|make)\b.*\b(code|script|program|hello world)\b/,
  ].some((pattern) => pattern.test(message));
}

function hasHealthContext(message: string): boolean {
  return [
    /\b(health|medical|medicine|medication|drug|dose|allergy|allergies|symptom|symptoms)\b/,
    /\b(pain|fever|cough|cold|flu|headache|nausea|vomit|rash|bleeding|breathing)\b/,
    /\b(doctor|clinician|nurse|hospital|clinic|appointment|prescription|diagnosis)\b/,
    /\b(patient|care|wellness|treatment|therapy|follow up|emergency|urgent)\b/,
  ].some((pattern) => pattern.test(message));
}

function isInternalIdentifierField(value: string): boolean {
  return value === 'userId' || value === 'conversationId' || value === 'runId';
}
