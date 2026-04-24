import type {
  AgentMessage,
  AgentStep,
  AgentTool,
  AgentToolObservation,
  RunAgentInput,
  RunAgentResult,
} from './agent.types';
import { buildToolError } from '../common/errors/app-error';

const FALLBACK_FINAL_ANSWER =
  'I could not complete the full reasoning loop safely, but you could consider contacting a clinician if symptoms continue or worsen.';

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const maxIterations = resolveMaxIterations();
  const observations: AgentToolObservation[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    input.logger?.debug('agent.loop.iteration.started', {
      stage: 'reasoning',
      operation: 'loop_iteration',
      status: 'started',
      iteration: iteration + 1,
      maxIterations,
      ...input.runContext,
    });
    // Each iteration rebuilds the full prompt from history plus accumulated observations
    // so the model can reason over prior tool results without hidden mutable state.
    const prompt = buildPrompt({
      history: input.history,
      tools: input.tools,
      userMessage: input.userMessage,
      observations,
      iteration: iteration + 1,
      maxIterations,
    });
    const rawStep = await input.llm(prompt);
    const parsedStep = parseAgentStep(rawStep);
    // The loop tolerates one malformed model response and asks for a repair pass before
    // falling back to a bounded safe answer.
    if (!parsedStep) {
      input.logger?.warn('agent.loop.repair_requested', {
        stage: 'reasoning',
        operation: 'repair_pass',
        status: 'retrying',
        iteration: iteration + 1,
        ...input.runContext,
      });
    }
    const step = parsedStep ?? parseAgentStep(await input.llm(buildRepairPrompt(rawStep)));

    if (!step) {
      input.logger?.warn('agent.loop.fallback.invalid_json', {
        stage: 'reasoning',
        operation: 'loop_exit',
        status: 'fallback',
        iteration: iteration + 1,
        reason: 'invalid_json_after_repair',
        ...input.runContext,
      });
      return {
        finalAction: 'final_answer',
        finalAnswerBrief: FALLBACK_FINAL_ANSWER,
        toolObservations: observations,
        iterationsUsed: iteration + 1,
      };
    }

    if (step.action === 'final_answer') {
      await Promise.resolve(
        input.stream(
          JSON.stringify({
            type: 'reasoning.delta',
            delta: 'Prepared a final response from the available conversation context.',
          }),
        ),
      );
      input.logger?.debug('agent.loop.final_answer', {
        stage: 'reasoning',
        operation: 'loop_exit',
        status: 'completed',
        iteration: iteration + 1,
        finalAction: step.action,
        ...input.runContext,
      });
      return {
        finalAction: step.action,
        finalAnswerBrief: step.answer.trim() || FALLBACK_FINAL_ANSWER,
        toolObservations: observations,
        iterationsUsed: iteration + 1,
      };
    }

    input.logger?.debug('agent.loop.action.selected', {
      stage: 'reasoning',
      operation: 'tool_selection',
      status: 'selected',
      iteration: iteration + 1,
      toolName: step.action,
      ...input.runContext,
    });
    await Promise.resolve(
      input.stream(
        JSON.stringify({
          type: 'reasoning.delta',
          delta: `Selected ${step.action} to gather supporting information.`,
        }),
      ),
    );
    const tool = input.tools.find((candidate) => candidate.name === step.action);

    if (!tool) {
      const appError = buildToolError(new Error(`Tool not found: ${step.action}`), {
        toolName: step.action,
        kind: 'tool_not_found',
      });
      input.logger?.warn('agent.loop.tool.missing', {
        stage: 'tool',
        operation: 'tool_lookup',
        status: 'missing',
        iteration: iteration + 1,
        toolName: step.action,
        errorCode: appError.code,
        ...input.runContext,
      });
      // Unknown tools are treated as observations instead of hard failures so the model
      // gets another chance to recover in the next iteration.
      await Promise.resolve(
        input.stream(
          JSON.stringify({
            type: 'tool.call.started',
            toolName: step.action,
            input: step.input,
          }),
        ),
      );
      await Promise.resolve(
        input.stream(
          JSON.stringify({
            type: 'tool.call.completed',
            toolName: step.action,
            output: {
              error: appError.message,
              appError,
            },
          }),
        ),
      );
      observations.push({
        toolName: step.action,
        input: step.input,
        output: {
          error: appError.message,
          appError,
        },
      });
      continue;
    }

    try {
      // Tool lifecycle is surfaced through `stream()` immediately so the outer agent
      // service can forward it as SSE events while the loop is still running.
      await Promise.resolve(
        input.stream(
          JSON.stringify({
            type: 'tool.call.started',
            toolName: tool.name,
            input: step.input,
          }),
        ),
      );
      const toolOutput = await tool.execute(step.input);
      input.logger?.debug('agent.loop.tool.completed', {
        stage: 'tool',
        operation: 'tool_execution',
        status: 'completed',
        iteration: iteration + 1,
        toolName: tool.name,
        ...input.runContext,
      });
      await Promise.resolve(
        input.stream(
          JSON.stringify({
            type: 'tool.call.completed',
            toolName: tool.name,
            output: toolOutput,
          }),
        ),
      );

      observations.push({
        toolName: tool.name,
        input: step.input,
        output: toolOutput,
      });
    } catch (error) {
      const appError = buildToolError(error, {
        toolName: tool.name,
        kind: 'tool_execution_failed',
      });
      input.logger?.warn('agent.loop.tool.failed', {
        stage: 'tool',
        operation: 'tool_execution',
        status: 'failed',
        iteration: iteration + 1,
        toolName: tool.name,
        errorCode: appError.code,
        ...input.runContext,
      });
      // Tool failures are folded back into the observation list so the model can either
      // choose another action or stop with a final answer.
      await Promise.resolve(
        input.stream(
          JSON.stringify({
            type: 'tool.call.completed',
            toolName: tool.name,
            output: {
              error: appError.message,
              appError,
            },
          }),
        ),
      );
      observations.push({
        toolName: tool.name,
        input: step.input,
        output: {
          error: appError.message,
          appError,
        },
      });
    }
  }

  input.logger?.warn('agent.loop.iteration_cap_reached', {
    stage: 'reasoning',
    operation: 'loop_exit',
    status: 'fallback',
    maxIterations,
    reason: 'iteration_cap_reached',
    ...input.runContext,
  });
  return {
    finalAction: 'final_answer',
    finalAnswerBrief:
      'I reached the iteration limit before completing the task. You could consider asking again with a more specific message.',
    toolObservations: observations,
    iterationsUsed: maxIterations,
  };
}

function resolveMaxIterations(): number {
  const rawValue = Number(process.env.AGENT_MAX_CAP);

  if (!Number.isFinite(rawValue) || rawValue < 1) {
    return 5;
  }

  return Math.floor(rawValue);
}

function buildPrompt(input: {
  history: AgentMessage[];
  tools: AgentTool[];
  userMessage: string;
  observations: AgentToolObservation[];
  iteration: number;
  maxIterations: number;
}): string {
  return [
    'You are an agent that must respond with strict JSON only.',
    'Loop: think -> decide -> act -> observe.',
    `Current iteration: ${input.iteration}/${input.maxIterations}.`,
    'Stop by returning {"action":"final_answer", ...}.',
    '',
    'STRICT JSON FORMAT:',
    JSON.stringify({
      thought: 'string',
      action: 'tool_name_or_final_answer',
      input: {},
      answer: 'string',
    }),
    '',
    'AVAILABLE TOOLS:',
    JSON.stringify(
      input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
    ),
    '',
    'CONVERSATION HISTORY:',
    JSON.stringify(input.history),
    '',
    'LATEST USER MESSAGE:',
    JSON.stringify(input.userMessage),
    '',
    'OBSERVATIONS SO FAR:',
    JSON.stringify(input.observations),
    '',
    'Return only valid JSON.',
  ].join('\n');
}

function buildRepairPrompt(rawStep: string): string {
  return [
    'Your previous response was invalid.',
    'Return only strict JSON with this shape:',
    JSON.stringify({
      thought: 'string',
      action: 'tool_name_or_final_answer',
      input: {},
      answer: 'string',
    }),
    'Previous invalid response:',
    rawStep,
  ].join('\n');
}

function parseAgentStep(rawStep: string): AgentStep | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawStep);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;

  // Keep validation intentionally small and explicit. The loop only needs enough shape
  // checking to ensure the next action is safe to execute.
  if (
    typeof candidate.thought !== 'string' ||
    typeof candidate.action !== 'string' ||
    !candidate.input ||
    typeof candidate.input !== 'object' ||
    Array.isArray(candidate.input) ||
    typeof candidate.answer !== 'string'
  ) {
    return null;
  }

  return {
    thought: candidate.thought,
    action: candidate.action,
    input: candidate.input as Record<string, unknown>,
    answer: candidate.answer,
  };
}
