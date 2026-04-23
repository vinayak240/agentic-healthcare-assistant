import { describe, expect, it } from 'bun:test';
import { runAgent } from '../src/agent/run-agent';
import type { AgentTool } from '../src/agent/agent.types';

describe('runAgent', () => {
  it('returns immediately when the model picks final_answer', async () => {
    const result = await runAgent({
      llm: async () =>
        JSON.stringify({
          thought: 'done',
          action: 'final_answer',
          input: {},
          answer: 'Brief final answer',
        }),
      tools: [],
      history: [],
      userMessage: 'hello',
      stream: () => {},
    });

    expect(result.finalAction).toBe('final_answer');
    expect(result.finalAnswerBrief).toBe('Brief final answer');
    expect(result.iterationsUsed).toBe(1);
  });

  it('executes a tool and then returns final_answer', async () => {
    const streamed: string[] = [];
    const tools: AgentTool[] = [
      {
        name: 'lookup',
        description: 'Looks something up',
        input_schema: { type: 'object' },
        async execute(input) {
          return { echoed: input.query };
        },
      },
    ];
    let callCount = 0;

    const result = await runAgent({
      llm: async () => {
        callCount += 1;

        if (callCount === 1) {
          return JSON.stringify({
            thought: 'need tool',
            action: 'lookup',
            input: { query: 'fever' },
            answer: '',
          });
        }

        return JSON.stringify({
          thought: 'done',
          action: 'final_answer',
          input: {},
          answer: 'Use the tool result in the final answer',
        });
      },
      tools,
      history: [],
      userMessage: 'I have fever',
      stream: (chunk) => {
        streamed.push(chunk);
      },
    });

    expect(result.toolObservations).toEqual([
      {
        toolName: 'lookup',
        input: { query: 'fever' },
        output: { echoed: 'fever' },
      },
    ]);
    expect(streamed).toHaveLength(2);
    expect(JSON.parse(streamed[0])).toEqual({
      type: 'tool.call.started',
      toolName: 'lookup',
      input: { query: 'fever' },
    });
    expect(JSON.parse(streamed[1])).toEqual({
      type: 'tool.call.completed',
      toolName: 'lookup',
      output: { echoed: 'fever' },
    });
  });

  it('retries once on invalid JSON and succeeds', async () => {
    let callCount = 0;

    const result = await runAgent({
      llm: async () => {
        callCount += 1;

        return callCount === 1
          ? 'not json'
          : JSON.stringify({
              thought: 'fixed',
              action: 'final_answer',
              input: {},
              answer: 'Recovered after retry',
            });
      },
      tools: [],
      history: [],
      userMessage: 'retry please',
      stream: () => {},
    });

    expect(result.finalAnswerBrief).toBe('Recovered after retry');
    expect(callCount).toBe(2);
  });

  it('falls back safely after repeated invalid JSON', async () => {
    const result = await runAgent({
      llm: async () => 'still bad',
      tools: [],
      history: [],
      userMessage: 'bad output',
      stream: () => {},
    });

    expect(result.finalAction).toBe('final_answer');
    expect(result.finalAnswerBrief).toContain('could not complete');
  });

  it('records missing tools as observations instead of crashing', async () => {
    let callCount = 0;

    const result = await runAgent({
      llm: async () => {
        callCount += 1;

        if (callCount === 1) {
          return JSON.stringify({
            thought: 'need missing tool',
            action: 'missing_tool',
            input: { value: 1 },
            answer: '',
          });
        }

        return JSON.stringify({
          thought: 'done',
          action: 'final_answer',
          input: {},
          answer: 'Fallback after missing tool',
        });
      },
      tools: [],
      history: [],
      userMessage: 'missing tool flow',
      stream: () => {},
    });

    expect(result.toolObservations[0]).toEqual({
      toolName: 'missing_tool',
      input: { value: 1 },
      output: {
        error: 'One of the assistant tools failed, so the answer may use limited data.',
        appError: expect.objectContaining({
          code: 'TOOL_EXECUTION_FAILED',
          stage: 'tool',
        }),
      },
    });
  });
});
