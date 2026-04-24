import type { AppError } from '../common/errors/app-error';
import type { LoggerService } from '../logger/logger.service';

export interface AgentRunContext {
  userId: string;
  conversationId: string;
  runId: string;
  message: string;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface AgentStep {
  thought: string;
  action: string;
  input: Record<string, unknown>;
  answer: string;
}

export interface AgentToolObservation {
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface RunAgentInput {
  llm: (prompt: string) => Promise<string>;
  tools: AgentTool[];
  history: AgentMessage[];
  userMessage: string;
  stream: (chunk: string) => void;
  logger?: Pick<LoggerService, 'debug' | 'warn' | 'error'>;
  runContext?: {
    userId: string;
    conversationId: string;
    runId: string;
  };
}

export interface RunAgentResult {
  finalAction: string;
  finalAnswerBrief: string;
  toolObservations: AgentToolObservation[];
  iterationsUsed: number;
}

export type AgentEvent =
  | {
      type: 'message.delta';
      delta: string;
    }
  | {
      type: 'message.completed';
      message: string;
    }
  | {
      type: 'tool.call.started';
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool.call.completed';
      toolName: string;
      output: Record<string, unknown>;
    }
  | {
      type: 'usage.final';
      totalTokens: number;
    }
  | {
      type: 'run.warning';
      error: AppError;
    };
