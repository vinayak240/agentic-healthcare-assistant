import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'bun:test';
import type { TestingModule } from '@nestjs/testing';
import { ChatRequestDto } from '../src/api/dto/chat-request.dto';
import { ConversationIdParamDto } from '../src/api/dto/conversation-id-param.dto';
import { ConversationListQueryDto } from '../src/api/dto/conversation-list-query.dto';
import { CreateUserDto } from '../src/api/dto/create-user.dto';
import { PaginationDto } from '../src/api/dto/pagination.dto';
import { RunIdParamDto } from '../src/api/dto/run-id-param.dto';
import { UsageRangeQueryDto } from '../src/api/dto/usage-range-query.dto';
import { UserIdParamDto } from '../src/api/dto/user-id-param.dto';
import { UserUsageParamDto } from '../src/api/dto/user-usage-param.dto';
import {
  closeTestContext,
  createApiTestContext,
  createConversationDoc,
  createMessageDoc,
  TEST_IDS,
  validateDto,
} from './helpers/api-test-app';

describe('API layer', () => {
  let moduleRef: TestingModule | null = null;

  afterEach(async () => {
    await closeTestContext(moduleRef);
    moduleRef = null;
  });

  it('POST /chat flow returns the final assistant response and persists the run lifecycle', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const body = await validateDto(
      ctx.validationPipe,
      {
        userId: TEST_IDS.userId,
        message: 'I need help with my medication schedule',
      },
      { type: 'body', metatype: ChatRequestDto, data: '' },
    );

    const response = await ctx.controllers.chat.createChatMessage(body);

    expect(response.conversation.id).toBe(TEST_IDS.conversationId);
    expect(response.run.id).toBe(TEST_IDS.runId);
    expect(response.run.status).toBe('completed');
    expect(response.assistantMessage.text).toBe('Mock assistant reply');
    expect(response.warnings).toEqual([]);
    expect(response.usage).toBeNull();
    expect(ctx.mocks.messagesRepository.createCalls).toHaveLength(2);
    expect(ctx.mocks.usagesRepository.createCalls).toHaveLength(0);
    expect(
      ctx.mocks.appEventEmitter.emitCalls.some(
        (call) => call.type === 'usage_final' && call.payload?.totalTokens === 144,
      ),
    ).toBe(true);
    expect(ctx.mocks.runsRepository.updateCalls.some((call) => {
      const set = call.update.$set as { status?: string } | undefined;
      return set?.status === 'completed';
    })).toBe(true);
    expect(ctx.mocks.agentService.calls).toHaveLength(1);
  });

  it('POST /chat fails fast when the user does not exist', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const body = await validateDto(
      ctx.validationPipe,
      {
        userId: '507f1f77bcf86cd799439099',
        message: 'I need help',
      },
      { type: 'body', metatype: ChatRequestDto, data: '' },
    );

    await expect(ctx.controllers.chat.createChatMessage(body)).rejects.toMatchObject({
      appError: expect.objectContaining({
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      }),
    });
    expect(ctx.mocks.agentService.calls).toHaveLength(0);
  });

  it('chat request DTO validation rejects invalid payloads', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    await expect(
      validateDto(
        ctx.validationPipe,
        { userId: TEST_IDS.userId },
        { type: 'body', metatype: ChatRequestDto, data: '' },
      ),
    ).rejects.toThrow();
  });

  it('POST /chat/stream emits structured SSE events in order', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const writes: string[] = [];
    const response = createMockSseResponse(writes);
    const body = await validateDto(
      ctx.validationPipe,
      {
        userId: TEST_IDS.userId,
        message: 'Summarize my visit notes',
      },
      { type: 'body', metatype: ChatRequestDto, data: '' },
    );

    await ctx.controllers.chat.streamChatMessage(body, response as never);

    const events = parseSseEvents(writes.join(''));
    const types = events.map((event) => event.type);

    expect(response.headers['Content-Type']).toBe('text/event-stream');
    expect(response.flushHeadersCalled).toBe(true);
    expect(types[0]).toBe('run.started');
    expect(types).toContain('tool.call.started');
    expect(types).toContain('tool.call.completed');
    expect(types.filter((type) => type === 'message.delta').length).toBeGreaterThan(0);
    expect(types).toContain('message.completed');
    expect(types).toContain('usage.final');
    expect(types.at(-1)).toBe('run.completed');
    expect(events.every((event) => event.runId === TEST_IDS.runId)).toBe(true);
  });

  it('POST /chat/stream fails before opening SSE when preflight fails', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const writes: string[] = [];
    const response = createMockSseResponse(writes);
    const body = await validateDto(
      ctx.validationPipe,
      {
        userId: '507f1f77bcf86cd799439099',
        message: 'This should fail before streaming',
      },
      { type: 'body', metatype: ChatRequestDto, data: '' },
    );

    await expect(ctx.controllers.chat.streamChatMessage(body, response as never)).rejects.toMatchObject(
      {
        appError: expect.objectContaining({
          code: 'USER_NOT_FOUND',
          statusCode: 404,
        }),
      },
    );
    expect(response.flushHeadersCalled).toBe(false);
    expect(writes).toEqual([]);
  });

  it('POST /chat marks the run as failed when the agent stream errors', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    ctx.mocks.agentService.streamResponse = async function* () {
      throw new Error('agent unavailable');
    };

    const body = await validateDto(
      ctx.validationPipe,
      {
        userId: TEST_IDS.userId,
        message: 'This should fail',
      },
      { type: 'body', metatype: ChatRequestDto, data: '' },
    );

    await expect(ctx.controllers.chat.createChatMessage(body)).rejects.toMatchObject({
      appError: expect.objectContaining({
        code: 'CHAT_INTERNAL_ERROR',
        statusCode: 500,
      }),
    });
    expect(ctx.mocks.runsRepository.updateCalls.some((call) => {
      const set = call.update.$set as { status?: string } | undefined;
      return set?.status === 'failed';
    })).toBe(true);
    expect(
      ctx.mocks.appEventEmitter.emitCalls.some(
        (call) =>
          call.type === 'run_failed' &&
          call.payload?.errorCode === 'CHAT_INTERNAL_ERROR' &&
          call.payload?.errorStatusCode === 500,
      ),
    ).toBe(true);
  });

  it('POST /chat returns warnings when the final answer is degraded but completed', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    ctx.mocks.agentService.streamResponse = async function* () {
      yield {
        type: 'run.warning' as const,
        error: {
          code: 'LLM_RENDERING_FAILED',
          message: 'The answer was delivered with a fallback response.',
          retryable: true,
          stage: 'rendering' as const,
          statusCode: 200,
          details: {
            causeCode: 'LLM_UNAVAILABLE',
          },
        },
      };
      yield {
        type: 'message.delta' as const,
        delta: 'Fallback answer',
      };
      yield {
        type: 'message.completed' as const,
        message: 'Fallback answer',
      };
      yield {
        type: 'usage.final' as const,
        totalTokens: 64,
      };
    };

    const body = await validateDto(
      ctx.validationPipe,
      {
        userId: TEST_IDS.userId,
        message: 'Give me the answer',
      },
      { type: 'body', metatype: ChatRequestDto, data: '' },
    );

    const response = await ctx.controllers.chat.createChatMessage(body);

    expect(response.run.status).toBe('completed');
    expect(response.assistantMessage.text).toBe('Fallback answer');
    expect(response.warnings).toEqual([
      expect.objectContaining({
        code: 'LLM_RENDERING_FAILED',
        stage: 'rendering',
      }),
    ]);
  });

  it('POST /chat/stream emits run.warning and run.failed payloads for the UI', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const writes: string[] = [];
    const response = createMockSseResponse(writes);
    let callCount = 0;
    ctx.mocks.agentService.streamResponse = async function* () {
      callCount += 1;

      if (callCount === 1) {
        yield {
          type: 'run.warning' as const,
          error: {
            code: 'LLM_RENDERING_FAILED',
            message: 'The answer was delivered with a fallback response.',
            retryable: true,
            stage: 'rendering' as const,
            statusCode: 200,
          },
        };
        yield {
          type: 'message.completed' as const,
          message: 'Fallback answer',
        };
        yield {
          type: 'usage.final' as const,
          totalTokens: 32,
        };
        return;
      }

      throw new Error('unused');
    };

    const body = await validateDto(
      ctx.validationPipe,
      {
        userId: TEST_IDS.userId,
        message: 'Trigger a warning',
      },
      { type: 'body', metatype: ChatRequestDto, data: '' },
    );

    await ctx.controllers.chat.streamChatMessage(body, response as never);

    const events = parseSseEvents(writes.join(''));

    expect(events.some((event) => event.type === 'run.warning')).toBe(true);
    expect(events.some((event) => event.type === 'run.completed')).toBe(true);

    writes.length = 0;
    const failedResponse = createMockSseResponse(writes);
    ctx.mocks.agentService.streamResponse = async function* () {
      throw new Error('boom');
    };

    await ctx.controllers.chat.streamChatMessage(body, failedResponse as never);

    const failedEvents = parseSseEvents(writes.join(''));

    expect(failedEvents.some((event) => event.type === 'run.failed')).toBe(true);
    expect(failedEvents.some((event) => event.type === 'error')).toBe(true);
  });

  it('GET /conversations returns a paginated conversation list', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    ctx.mocks.conversationsRepository.findPageByUserId = async (input) => {
      ctx.mocks.conversationsRepository.listCalls.push(input);

      return [
        createConversationDoc(TEST_IDS.conversationId, 'Conversation A', '2026-04-23T09:00:00.000Z'),
        createConversationDoc('507f1f77bcf86cd799439020', 'Conversation B', '2026-04-22T09:00:00.000Z'),
      ];
    };

    const query = await validateDto(
      ctx.validationPipe,
      { userId: TEST_IDS.userId, limit: '1' },
      { type: 'query', metatype: ConversationListQueryDto, data: '' },
    );

    const response = await ctx.controllers.conversation.listConversations(query);

    expect(response.items).toHaveLength(1);
    expect(response.items[0].id).toBe(TEST_IDS.conversationId);
    expect(typeof response.nextCursor).toBe('string');
    expect(ctx.mocks.conversationsRepository.listCalls[0]).toEqual({
      userId: TEST_IDS.userId,
      limit: 2,
      cursor: undefined,
    });
  });

  it('conversation list query DTO validation rejects missing userId and bad cursor', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    await expect(
      validateDto(
        ctx.validationPipe,
        {},
        { type: 'query', metatype: ConversationListQueryDto, data: '' },
      ),
    ).rejects.toThrow();

    const query = await validateDto(
      ctx.validationPipe,
      { userId: TEST_IDS.userId, cursor: 'not-base64' },
      { type: 'query', metatype: ConversationListQueryDto, data: '' },
    );

    await expect(ctx.controllers.conversation.listConversations(query)).rejects.toThrow(
      'Invalid conversation cursor',
    );
  });

  it('GET /conversations/:id returns conversation metadata', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const params = await validateDto(
      ctx.validationPipe,
      { id: TEST_IDS.conversationId },
      { type: 'param', metatype: ConversationIdParamDto, data: '' },
    );

    const response = await ctx.controllers.conversation.getConversation(params);

    expect(response.id).toBe(TEST_IDS.conversationId);
    expect(response.title).toBe('Existing conversation');
  });

  it('GET /conversations/:id/messages returns cursor-paginated messages', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    ctx.mocks.messagesRepository.findPageByConversationId = async (input) => {
      ctx.mocks.messagesRepository.listCalls.push(input);

      return [
        createMessageDoc(TEST_IDS.assistantMessageId, 'assistant', '2026-04-23T09:03:00.000Z'),
        createMessageDoc(TEST_IDS.userMessageId, 'user', '2026-04-23T09:02:00.000Z'),
      ];
    };

    const params = await validateDto(
      ctx.validationPipe,
      { id: TEST_IDS.conversationId },
      { type: 'param', metatype: ConversationIdParamDto, data: '' },
    );
    const query = await validateDto(
      ctx.validationPipe,
      { limit: '1' },
      { type: 'query', metatype: PaginationDto, data: '' },
    );

    const response = await ctx.controllers.conversation.listMessages(params, query);

    expect(response.items).toHaveLength(1);
    expect(response.items[0].role).toBe('assistant');
    expect(typeof response.nextCursor).toBe('string');
    expect(ctx.mocks.messagesRepository.listCalls[0]).toEqual({
      conversationId: TEST_IDS.conversationId,
      limit: 2,
      cursor: undefined,
    });
  });

  it('GET /runs/:id returns run metadata', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const params = await validateDto(
      ctx.validationPipe,
      { id: TEST_IDS.runId },
      { type: 'param', metatype: RunIdParamDto, data: '' },
    );

    const response = await ctx.controllers.run.getRun(params);

    expect(response.id).toBe(TEST_IDS.runId);
    expect(response.status).toBe('completed');
  });

  it('GET /usage/run/:id returns run usage', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const params = await validateDto(
      ctx.validationPipe,
      { id: TEST_IDS.runId },
      { type: 'param', metatype: RunIdParamDto, data: '' },
    );

    const response = await ctx.controllers.usage.getRunUsage(params);

    expect(response?.runId).toBe(TEST_IDS.runId);
    expect(response?.totalTokens).toBe(144);
  });

  it('GET /usage/user/:userId returns aggregated usage and passes the date range to the repository', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const params = await validateDto(
      ctx.validationPipe,
      { userId: TEST_IDS.userId },
      { type: 'param', metatype: UserUsageParamDto, data: '' },
    );
    const query = await validateDto(
      ctx.validationPipe,
      {
        from: '2026-04-20T00:00:00.000Z',
        to: '2026-04-23T23:59:59.000Z',
      },
      { type: 'query', metatype: UsageRangeQueryDto, data: '' },
    );

    const response = await ctx.controllers.usage.getUserUsage(params, query);

    expect(response.userId).toBe(TEST_IDS.userId);
    expect(response.totalTokens).toBe(200);
    expect(response.items).toHaveLength(2);
    expect(ctx.mocks.usagesRepository.rangeCalls[0]).toEqual({
      userId: TEST_IDS.userId,
      from: new Date('2026-04-20T00:00:00.000Z'),
      to: new Date('2026-04-23T23:59:59.000Z'),
    });
  });

  it('POST /users creates a user with normalized email and health profile arrays', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const body = await validateDto(
      ctx.validationPipe,
      {
        name: '  Jane Doe  ',
        email: 'Jane.Doe@Example.com',
        allergies: [' Penicillin ', ''],
        medicalConditions: [' Asthma '],
        medicalHistory: [' Seasonal allergies '],
      },
      { type: 'body', metatype: CreateUserDto, data: '' },
    );

    const response = await ctx.controllers.user.createUser(body);

    expect(response.id).toBe(TEST_IDS.userId);
    expect(response.email).toBe('jane.doe@example.com');
    expect(response.allergies).toEqual(['Penicillin']);
    expect(response.medicalConditions).toEqual(['Asthma']);
    expect(response.medicalHistory).toEqual(['Seasonal allergies']);
    expect(ctx.mocks.usersRepository.createCalls[0]).toEqual({
      name: 'Jane Doe',
      email: 'jane.doe@example.com',
      allergies: ['Penicillin'],
      medicalConditions: ['Asthma'],
      medicalHistory: ['Seasonal allergies'],
    });
  });

  it('POST /users rejects duplicate emails', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const body = await validateDto(
      ctx.validationPipe,
      {
        name: 'Test User',
        email: 'test@example.com',
      },
      { type: 'body', metatype: CreateUserDto, data: '' },
    );

    await expect(ctx.controllers.user.createUser(body)).rejects.toThrow(
      'User with this email already exists',
    );
  });

  it('GET /users returns the user list', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const response = await ctx.controllers.user.listUsers();

    expect(response.items).toHaveLength(1);
    expect(response.items[0].id).toBe(TEST_IDS.userId);
  });

  it('GET /users/:id returns one user', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const params = await validateDto(
      ctx.validationPipe,
      { id: TEST_IDS.userId },
      { type: 'param', metatype: UserIdParamDto, data: '' },
    );

    const response = await ctx.controllers.user.getUser(params);

    expect(response.id).toBe(TEST_IDS.userId);
    expect(response.email).toBe('test@example.com');
  });

  it('create user DTO validation rejects invalid emails', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    await expect(
      validateDto(
        ctx.validationPipe,
        {
          name: 'Jane Doe',
          email: 'not-an-email',
        },
        { type: 'body', metatype: CreateUserDto, data: '' },
      ),
    ).rejects.toThrow();
  });

  it('usage range DTO validation rejects invalid date filters', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    await expect(
      validateDto(
        ctx.validationPipe,
        { from: 'yesterday' },
        { type: 'query', metatype: UsageRangeQueryDto, data: '' },
      ),
    ).rejects.toThrow();
  });

  it('GET /system/health returns liveness status', async () => {
    const ctx = await createApiTestContext();
    moduleRef = ctx.moduleRef;

    const response = ctx.controllers.system.getHealth();

    expect(response.status).toBe('ok');
    expect(typeof response.timestamp).toBe('string');
  });
});

function createMockSseResponse(writes: string[]) {
  return {
    headers: {} as Record<string, string>,
    flushHeadersCalled: false,
    writableEnded: false,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    flushHeaders() {
      this.flushHeadersCalled = true;
    },
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end() {
      this.writableEnded = true;
    },
  };
}

function parseSseEvents(raw: string): Array<{
  type: string;
  runId: string;
  timestamp: string;
  data: Record<string, unknown>;
}> {
  return raw
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => chunk.replace(/^data: /, ''))
    .map((chunk) => JSON.parse(chunk));
}
