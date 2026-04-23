export interface AgentRunContext {
  userId: string;
  conversationId: string;
  runId: string;
  message: string;
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
    };
