import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { ArgumentMetadata } from '@nestjs/common';
import { AgentService } from '../../src/agent/agent.service';
import { ChatController } from '../../src/api/controllers/chat.controller';
import { ConversationController } from '../../src/api/controllers/conversation.controller';
import { RunController } from '../../src/api/controllers/run.controller';
import { SystemController } from '../../src/api/controllers/system.controller';
import { UserController } from '../../src/api/controllers/user.controller';
import { UsageController } from '../../src/api/controllers/usage.controller';
import { ConversationService } from '../../src/api/services/conversation.service';
import { RunService } from '../../src/api/services/run.service';
import { SystemService } from '../../src/api/services/system.service';
import { UserService } from '../../src/api/services/user.service';
import { UsageService } from '../../src/api/services/usage.service';
import { ChatService } from '../../src/chat/chat.service';
import { ConversationsRepository } from '../../src/dal/repositories/conversations.repository';
import { MessagesRepository } from '../../src/dal/repositories/messages.repository';
import { RunsRepository } from '../../src/dal/repositories/runs.repository';
import { UsagesRepository } from '../../src/dal/repositories/usages.repository';
import { UsersRepository } from '../../src/dal/repositories/users.repository';
import { AppEventEmitter } from '../../src/events/emitter/event.emitter';

type WithId<T> = T & {
  _id: {
    toString(): string;
  };
};

type MockFunction<TArgs extends unknown[], TResult> = (...args: TArgs) => TResult;

export const TEST_IDS = {
  userId: '507f1f77bcf86cd799439011',
  conversationId: '507f1f77bcf86cd799439012',
  runId: '507f1f77bcf86cd799439013',
  assistantMessageId: '507f1f77bcf86cd799439014',
  userMessageId: '507f1f77bcf86cd799439015',
  usageId: '507f1f77bcf86cd799439016',
} as const;

export interface MockRepositories {
  conversationsRepository: {
    create: MockFunction<[Record<string, unknown>], Promise<unknown>>;
    findById: MockFunction<[string], Promise<unknown>>;
    updateById: MockFunction<[string, Record<string, unknown>], Promise<unknown>>;
    findPageByUserId: MockFunction<[Record<string, unknown>], Promise<unknown[]>>;
    createCalls: Array<Record<string, unknown>>;
    updateCalls: Array<{ id: string; update: Record<string, unknown> }>;
    listCalls: Array<Record<string, unknown>>;
  };
  messagesRepository: {
    create: MockFunction<[Record<string, unknown>], Promise<unknown>>;
    findPageByConversationId: MockFunction<[Record<string, unknown>], Promise<unknown[]>>;
    createCalls: Array<Record<string, unknown>>;
    listCalls: Array<Record<string, unknown>>;
  };
  runsRepository: {
    create: MockFunction<[Record<string, unknown>], Promise<unknown>>;
    findById: MockFunction<[string], Promise<unknown>>;
    updateById: MockFunction<[string, Record<string, unknown>], Promise<unknown>>;
    createCalls: Array<Record<string, unknown>>;
    updateCalls: Array<{ id: string; update: Record<string, unknown> }>;
  };
  usagesRepository: {
    create: MockFunction<[Record<string, unknown>], Promise<unknown>>;
    upsertByRunId: MockFunction<[Record<string, unknown>], Promise<unknown>>;
    findByRunId: MockFunction<[string], Promise<unknown>>;
    findByUserIdAndRange: MockFunction<[Record<string, unknown>], Promise<unknown[]>>;
    createCalls: Array<Record<string, unknown>>;
    upsertCalls: Array<Record<string, unknown>>;
    rangeCalls: Array<Record<string, unknown>>;
  };
  appEventEmitter: {
    emitEvent: MockFunction<[Record<string, unknown>], Promise<void>>;
    emitCalls: Array<Record<string, unknown>>;
  };
  usersRepository: {
    create: MockFunction<[Record<string, unknown>], Promise<unknown>>;
    findById: MockFunction<[string], Promise<unknown>>;
    findByEmail: MockFunction<[string], Promise<unknown>>;
    findMany: MockFunction<[], Promise<unknown[]>>;
    createCalls: Array<Record<string, unknown>>;
    findByEmailCalls: string[];
  };
  agentService: {
    assertReady: () => void;
    streamResponse: AgentService['streamResponse'];
    calls: Array<Record<string, unknown>>;
  };
}

export async function createApiTestContext() {
  const now = new Date('2026-04-23T10:00:00.000Z');

  const conversationsRepository = {
    createCalls: [] as Array<Record<string, unknown>>,
    updateCalls: [] as Array<{ id: string; update: Record<string, unknown> }>,
    listCalls: [] as Array<Record<string, unknown>>,
    async create(input: Record<string, unknown>) {
      conversationsRepository.createCalls.push(input);

      return createDocument(TEST_IDS.conversationId, {
        userId: input.userId,
        title: input.title ?? 'Test conversation',
        lastMessageAt: input.lastMessageAt ?? now,
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async findById(id: string) {
      if (id !== TEST_IDS.conversationId) {
        return null;
      }

      return createDocument(TEST_IDS.conversationId, {
        userId: TEST_IDS.userId,
        title: 'Existing conversation',
        lastMessageAt: now,
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async updateById(id: string, update: Record<string, unknown>) {
      conversationsRepository.updateCalls.push({ id, update });

      return createDocument(id, {
        userId: TEST_IDS.userId,
        title: 'Existing conversation',
        lastMessageAt: (update.$set as { lastMessageAt?: Date } | undefined)?.lastMessageAt ?? now,
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async findPageByUserId(input: Record<string, unknown>) {
      conversationsRepository.listCalls.push(input);

      return [
        createConversationDoc(TEST_IDS.conversationId, 'Follow-up', '2026-04-23T09:00:00.000Z'),
      ];
    },
  };

  const usersRepository = {
    createCalls: [] as Array<Record<string, unknown>>,
    findByEmailCalls: [] as string[],
    async create(input: Record<string, unknown>) {
      usersRepository.createCalls.push(input);

      return createDocument(TEST_IDS.userId, {
        name: input.name,
        email: input.email,
        allergies: input.allergies ?? [],
        medicalConditions: input.medicalConditions ?? [],
        medicalHistory: input.medicalHistory ?? [],
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async findById(id: string) {
      if (id !== TEST_IDS.userId) {
        return null;
      }

      return createDocument(TEST_IDS.userId, {
        name: 'Test User',
        email: 'test@example.com',
        allergies: [],
        medicalConditions: [],
        medicalHistory: [],
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async findByEmail(email: string) {
      usersRepository.findByEmailCalls.push(email);

      if (email !== 'test@example.com') {
        return null;
      }

      return createDocument(TEST_IDS.userId, {
        name: 'Test User',
        email: 'test@example.com',
        allergies: [],
        medicalConditions: [],
        medicalHistory: [],
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async findMany() {
      return [
        createDocument(TEST_IDS.userId, {
          name: 'Test User',
          email: 'test@example.com',
          allergies: [],
          medicalConditions: [],
          medicalHistory: [],
          cudFoil: {
            createdAt: now,
            updatedAt: now,
            deleted: false,
            deletedAt: null,
          },
        }),
      ];
    },
  };

  const messagesRepository = {
    createCalls: [] as Array<Record<string, unknown>>,
    listCalls: [] as Array<Record<string, unknown>>,
    async create(input: Record<string, unknown>) {
      messagesRepository.createCalls.push(input);

      return createDocument(
        input.role === 'assistant' ? TEST_IDS.assistantMessageId : TEST_IDS.userMessageId,
        {
          userId: input.userId,
          conversationId: input.conversationId,
          runId: input.runId,
          role: input.role,
          content: input.content,
          cudFoil: {
            createdAt: now,
            updatedAt: now,
            deleted: false,
            deletedAt: null,
          },
        },
      );
    },
    async findPageByConversationId(input: Record<string, unknown>) {
      messagesRepository.listCalls.push(input);

      return [createMessageDoc(TEST_IDS.assistantMessageId, 'assistant', '2026-04-23T09:03:00.000Z')];
    },
  };

  const runsRepository = {
    createCalls: [] as Array<Record<string, unknown>>,
    updateCalls: [] as Array<{ id: string; update: Record<string, unknown> }>,
    async create(input: Record<string, unknown>) {
      runsRepository.createCalls.push(input);

      return createDocument(TEST_IDS.runId, {
        userId: input.userId,
        conversationId: input.conversationId,
        status: input.status,
        startedAt: input.startedAt ?? now,
        endedAt: input.endedAt ?? null,
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async findById(id: string) {
      if (id !== TEST_IDS.runId) {
        return null;
      }

      return createDocument(TEST_IDS.runId, {
        userId: TEST_IDS.userId,
        conversationId: TEST_IDS.conversationId,
        status: 'completed',
        startedAt: new Date('2026-04-23T09:00:00.000Z'),
        endedAt: new Date('2026-04-23T09:01:00.000Z'),
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async updateById(id: string, update: Record<string, unknown>) {
      runsRepository.updateCalls.push({ id, update });

      const set = (update.$set as {
        status?: 'running' | 'completed' | 'failed';
        endedAt?: Date | null;
      }) ?? {
        status: 'completed',
        endedAt: now,
      };

      return createDocument(id, {
        userId: TEST_IDS.userId,
        conversationId: TEST_IDS.conversationId,
        status: set.status ?? 'completed',
        startedAt: new Date('2026-04-23T09:00:00.000Z'),
        endedAt: set.endedAt ?? null,
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
  };

  const usagesRepository = {
    createCalls: [] as Array<Record<string, unknown>>,
    upsertCalls: [] as Array<Record<string, unknown>>,
    rangeCalls: [] as Array<Record<string, unknown>>,
    async create(input: Record<string, unknown>) {
      usagesRepository.createCalls.push(input);

      return createDocument(TEST_IDS.usageId, {
        userId: input.userId,
        conversationId: input.conversationId,
        runId: input.runId,
        totalTokens: input.totalTokens,
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async upsertByRunId(input: Record<string, unknown>) {
      usagesRepository.upsertCalls.push(input);

      return createDocument(TEST_IDS.usageId, {
        userId: input.userId,
        conversationId: input.conversationId,
        runId: input.runId,
        totalTokens: input.totalTokens,
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async findByRunId(id: string) {
      if (id !== TEST_IDS.runId) {
        return null;
      }

      return createDocument(TEST_IDS.usageId, {
        userId: TEST_IDS.userId,
        conversationId: TEST_IDS.conversationId,
        runId: TEST_IDS.runId,
        totalTokens: 144,
        cudFoil: {
          createdAt: now,
          updatedAt: now,
          deleted: false,
          deletedAt: null,
        },
      });
    },
    async findByUserIdAndRange(input: Record<string, unknown>) {
      usagesRepository.rangeCalls.push(input);

      return [
        createDocument(TEST_IDS.usageId, {
          userId: TEST_IDS.userId,
          conversationId: TEST_IDS.conversationId,
          runId: TEST_IDS.runId,
          totalTokens: 144,
          cudFoil: {
            createdAt: now,
            updatedAt: now,
            deleted: false,
            deletedAt: null,
          },
        }),
        createDocument('507f1f77bcf86cd799439017', {
          userId: TEST_IDS.userId,
          conversationId: '507f1f77bcf86cd799439018',
          runId: '507f1f77bcf86cd799439019',
          totalTokens: 56,
          cudFoil: {
            createdAt: new Date('2026-04-22T09:00:00.000Z'),
            updatedAt: new Date('2026-04-22T09:00:00.000Z'),
            deleted: false,
            deletedAt: null,
          },
        }),
      ];
    },
  };

  const appEventEmitter = {
    emitCalls: [] as Array<Record<string, unknown>>,
    async emitEvent(input: Record<string, unknown>) {
      appEventEmitter.emitCalls.push(input);
    },
  };

  const agentService = {
    calls: [] as Array<Record<string, unknown>>,
    assertReady() {
      return undefined;
    },
    async *streamResponse(context: {
      userId: string;
      conversationId: string;
      runId: string;
      message: string;
    }) {
      agentService.calls.push(context);

      yield {
        type: 'tool.call.started' as const,
        toolName: 'mock-tool',
        input: {
          query: context.message,
        },
      };
      yield {
        type: 'tool.call.completed' as const,
        toolName: 'mock-tool',
        output: {
          ok: true,
        },
      };
      yield {
        type: 'message.delta' as const,
        delta: 'Mock assistant ',
      };
      yield {
        type: 'message.delta' as const,
        delta: 'reply',
      };
      yield {
        type: 'message.completed' as const,
        message: 'Mock assistant reply',
      };
      yield {
        type: 'usage.final' as const,
        totalTokens: 144,
      };
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [
      ChatController,
      ConversationController,
      RunController,
      UsageController,
      SystemController,
      UserController,
    ],
    providers: [
      ChatService,
      ConversationService,
      RunService,
      UsageService,
      SystemService,
      UserService,
      { provide: ConversationsRepository, useValue: conversationsRepository },
      { provide: MessagesRepository, useValue: messagesRepository },
      { provide: RunsRepository, useValue: runsRepository },
      { provide: UsagesRepository, useValue: usagesRepository },
      { provide: UsersRepository, useValue: usersRepository },
      { provide: AgentService, useValue: agentService },
      { provide: AppEventEmitter, useValue: appEventEmitter },
    ],
  }).compile();

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  return {
    moduleRef,
    validationPipe,
    controllers: {
      chat: moduleRef.get(ChatController),
      conversation: moduleRef.get(ConversationController),
      run: moduleRef.get(RunController),
      usage: moduleRef.get(UsageController),
      system: moduleRef.get(SystemController),
      user: moduleRef.get(UserController),
    },
    services: {
      chat: moduleRef.get(ChatService),
      conversation: moduleRef.get(ConversationService),
      run: moduleRef.get(RunService),
      usage: moduleRef.get(UsageService),
      system: moduleRef.get(SystemService),
      user: moduleRef.get(UserService),
    },
    mocks: {
      conversationsRepository,
      messagesRepository,
      runsRepository,
      usagesRepository,
      appEventEmitter,
      usersRepository,
      agentService,
    } satisfies MockRepositories,
  };
}

export async function validateDto<TValue>(
  pipe: ValidationPipe,
  value: TValue,
  metadata: ArgumentMetadata,
) {
  return pipe.transform(value, metadata);
}

export async function closeTestContext(moduleRef: TestingModule | null) {
  if (moduleRef) {
    await moduleRef.close();
  }
}

function createDocument<T extends Record<string, unknown>>(id: string, data: T): WithId<T> {
  return {
    _id: {
      toString: () => id,
    },
    ...data,
  };
}

export function createConversationDoc(id: string, title: string, lastMessageAt: string) {
  return {
    _id: {
      toString: () => id,
    },
    userId: TEST_IDS.userId,
    title,
    lastMessageAt: new Date(lastMessageAt),
    cudFoil: {
      createdAt: new Date(lastMessageAt),
      updatedAt: new Date(lastMessageAt),
      deleted: false,
      deletedAt: null,
    },
  };
}

export function createMessageDoc(id: string, role: 'assistant' | 'user', createdAt: string) {
  return {
    _id: {
      toString: () => id,
    },
    userId: TEST_IDS.userId,
    conversationId: TEST_IDS.conversationId,
    runId: TEST_IDS.runId,
    role,
    content: {
      text: role === 'assistant' ? 'Mock assistant reply' : 'User message',
    },
    cudFoil: {
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
      deleted: false,
      deletedAt: null,
    },
  };
}
