import { Injectable } from '@nestjs/common';
import type { AgentEvent, AgentRunContext } from './agent.types';

@Injectable()
export class AgentService {
  async *streamResponse(context: AgentRunContext): AsyncGenerator<AgentEvent> {
    const toolInput = {
      query: context.message,
    };
    const toolOutput = {
      summary: `Reviewed patient request for: ${context.message}`,
    };
    const finalMessage = [
      `I received: "${context.message}".`,
      'This is a temporary mock agent response for the API layer.',
      'The real agent can be plugged into the same streaming contract later.',
    ].join(' ');

    yield {
      type: 'tool.call.started',
      toolName: 'mock-clinical-context',
      input: toolInput,
    };

    yield {
      type: 'tool.call.completed',
      toolName: 'mock-clinical-context',
      output: toolOutput,
    };

    for (const delta of this.splitIntoDeltas(finalMessage)) {
      yield {
        type: 'message.delta',
        delta,
      };
    }

    yield {
      type: 'message.completed',
      message: finalMessage,
    };

    yield {
      type: 'usage.final',
      totalTokens: Math.max(32, finalMessage.length + context.message.length),
    };
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
}
