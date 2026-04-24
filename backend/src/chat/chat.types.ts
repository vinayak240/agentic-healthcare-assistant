import type { AppError } from '../common/errors/app-error';

export interface ChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
  title?: string;
}

export interface StructuredSseEvent<TData extends object = Record<string, unknown>> {
  type: string;
  runId: string;
  timestamp: string;
  data: TData;
}

export interface ChatResponse {
  conversation: {
    id: string;
    userId: string;
    title: string;
    lastMessageAt: string;
    createdAt: string | null;
    updatedAt: string | null;
  };
  run: {
    id: string;
    status: 'completed';
    startedAt: string;
    endedAt: string;
  };
  assistantMessage: {
    id: string;
    role: 'assistant';
    text: string;
    metadata?: {
      modelName?: string;
      totalTokens?: number;
      costUsd?: number;
    };
    createdAt: string | null;
  };
  warnings: AppError[];
  usage: {
    totalTokens: number;
  } | null;
}
