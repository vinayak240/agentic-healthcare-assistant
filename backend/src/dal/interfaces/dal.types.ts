import type { FilterQuery, Types, UpdateQuery } from 'mongoose';
import type {
  AppErrorCode,
  AppErrorDetails,
  AppErrorStage,
} from '../../common/errors/app-error';

import type { Conversation } from '../schemas/conversation.schema';
import type { Event } from '../schemas/event.schema';
import type { Message } from '../schemas/message.schema';
import type { Run } from '../schemas/run.schema';
import type { Usage } from '../schemas/usage.schema';
import type { User } from '../schemas/user.schema';

export type ObjectId = Types.ObjectId;

export type RunStatus = 'running' | 'completed' | 'failed';

export type MessageRole = 'system' | 'user' | 'assistant';

export interface MessageContent {
  text: string;
}

export type EventSource = 'agent' | 'user' | 'system';

export type EventType =
  | 'run_started'
  | 'llm_called'
  | 'tool_called'
  | 'tool_result'
  | 'message_created'
  | 'usage_final'
  | 'run_completed'
  | 'run_failed';

export interface EventPayload {
  input?: string;
  output?: string;
  toolName?: string;
  toolData?: Record<string, unknown>;
  error?: string;
  errorCode?: AppErrorCode;
  errorStage?: AppErrorStage;
  errorRetryable?: boolean;
  errorStatusCode?: number;
  errorDetails?: AppErrorDetails;
  totalTokens?: number;
}

export type UserFilter = FilterQuery<User>;
export type ConversationFilter = FilterQuery<Conversation>;
export type RunFilter = FilterQuery<Run>;
export type MessageFilter = FilterQuery<Message>;
export type EventFilter = FilterQuery<Event>;
export type UsageFilter = FilterQuery<Usage>;

export type UserUpdate = UpdateQuery<User>;
export type ConversationUpdate = UpdateQuery<Conversation>;
export type RunUpdate = UpdateQuery<Run>;
export type MessageUpdate = UpdateQuery<Message>;
export type UsageUpdate = UpdateQuery<Usage>;
