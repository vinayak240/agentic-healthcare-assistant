export interface User {
  id: string;
  name: string;
  email: string;
  allergies: string[];
  medicalConditions: string[];
  medicalHistory: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateUserInput {
  name: string;
  email: string;
  allergies: string[];
  medicalConditions: string[];
  medicalHistory: string[];
}

export interface LoginUserInput {
  email: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export interface ChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
  title?: string;
}

export interface ChatStreamBaseEvent<TType extends string, TData extends object> {
  type: TType;
  runId: string;
  timestamp: string;
  data: TData;
}

export type ChatStreamEvent =
  | ChatStreamBaseEvent<'run.started', { conversationId: string; status: string; userMessageId?: string }>
  | ChatStreamBaseEvent<
      'run.completed',
      {
        conversationId?: string;
        status: string;
        assistantMessageId?: string;
        createdAt?: string;
        metadata?: MessageMetadata;
      }
    >
  | ChatStreamBaseEvent<'reasoning.delta', { delta: string }>
  | ChatStreamBaseEvent<'message.delta', { delta: string }>
  | ChatStreamBaseEvent<'message.completed', { message: string }>
  | ChatStreamBaseEvent<'tool.call.started', { toolName: string; input: unknown }>
  | ChatStreamBaseEvent<'tool.call.completed', { toolName: string; output: unknown }>
  | ChatStreamBaseEvent<'usage.final', { totalTokens: number; modelName?: string; costUsd?: number }>
  | ChatStreamBaseEvent<'run.warning', { error: { message?: string; code?: string } }>;

export interface ConversationSummary {
  id: string;
  userId: string;
  title: string;
  lastMessageAt: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ConversationListResponse {
  items: ConversationSummary[];
  nextCursor: string | null;
}

export interface AppointmentFollowUpConfirmationMetadata {
  kind: 'appointment_follow_up_confirmation';
  handoffRunId: string;
  toolName: 'book_appointment';
  specialty?: string;
  reason?: string;
  doctorName?: string;
  phone?: string;
}

export interface MessageGenerationMetadata {
  modelName?: string;
  totalTokens?: number;
  costUsd?: number;
  audio?: MessageAudioMetadata;
}

export type MessageMetadata =
  | (AppointmentFollowUpConfirmationMetadata & MessageGenerationMetadata)
  | MessageGenerationMetadata
  | null;

export interface MessageAudioChunk {
  index: number;
  objectKey: string;
  contentType: string;
  url?: string;
}

export interface MessageAudioMetadata {
  status: 'ready';
  provider: 'openai';
  model: string;
  voice: string;
  generatedAt: string;
  chunks: MessageAudioChunk[];
}

export interface ConversationMessage {
  id: string;
  userId: string;
  conversationId: string;
  runId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  metadata: MessageMetadata;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ConversationMessagesResponse {
  conversationId: string;
  items: ConversationMessage[];
  nextCursor: string | null;
}

export interface ConversationToolEvent {
  id: string;
  conversationId: string;
  runId: string;
  type: 'tool_called' | 'tool_result' | 'reasoning_delta' | 'usage_final';
  createdAt: string;
  payload: {
    input?: string;
    output?: string;
    text?: string;
    toolName?: string;
    toolData?: Record<string, unknown>;
    error?: string;
    errorCode?: string;
    errorStage?: string;
    errorRetryable?: boolean;
    errorStatusCode?: number;
    errorDetails?: Record<string, unknown>;
    totalTokens?: number;
    modelName?: string;
    costUsd?: number;
  };
}

export interface ConversationToolEventsResponse {
  conversationId: string;
  items: ConversationToolEvent[];
}

export interface DeleteMessageResponse {
  id: string;
  conversationId: string;
  deleted: true;
}

export interface CreateAppointmentFollowUpInput {
  runId: string;
  specialty?: string;
  reason?: string;
  doctorName?: string;
  phone?: string;
}

export interface ApiErrorPayload {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}
