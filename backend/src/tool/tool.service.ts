import { Injectable, Optional } from '@nestjs/common';
import { normalizeError } from '../common/errors/app-error';
import { LoggerService } from '../logger/logger.service';
import { ToolRegistry } from './tool.registry';
import type { ToolDescriptor } from './tool.types';
import { BookAppointmentTool } from './tools/book-appointment.tool';
import { DrugInfoTool } from './tools/drug-info.tool';
import { PatientContextTool } from './tools/patient-context.tool';

@Injectable()
export class ToolService {
  private readonly logger: LoggerService;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    patientContextTool: PatientContextTool,
    drugInfoTool: DrugInfoTool,
    bookAppointmentTool: BookAppointmentTool,
    @Optional() logger: LoggerService = new LoggerService(),
  ) {
    this.logger = logger.child({
      component: ToolService.name,
    });
    // Tool providers are registered once at startup so the agent can work with a stable
    // runtime registry instead of importing concrete tool classes directly.
    this.toolRegistry.register(patientContextTool);
    this.toolRegistry.register(drugInfoTool);
    this.toolRegistry.register(bookAppointmentTool);
  }

  listTools(): ToolDescriptor[] {
    return this.toolRegistry.list();
  }

  async executeTool<TInput, TOutput>(name: string, input: TInput): Promise<TOutput> {
    const startedAt = Date.now();
    const inputSummary = this.summarizeInput(input);

    this.logger.debug('tool.execution.started', {
      stage: 'tool',
      operation: 'tool_execution',
      status: 'started',
      toolName: name,
      inputSummary,
    });

    try {
      const output = await this.toolRegistry.execute<TInput, TOutput>(name, input);

      this.logger.debug('tool.execution.completed', {
        stage: 'tool',
        operation: 'tool_execution',
        status: 'completed',
        toolName: name,
        durationMs: Date.now() - startedAt,
        outputSummary: this.summarizeOutput(output),
      });

      return output;
    } catch (error) {
      const appError = normalizeError(error, {
        stage: 'tool',
        fallbackCode: 'TOOL_EXECUTION_FAILED',
      });

      this.logger.warn('tool.execution.failed', {
        stage: 'tool',
        operation: 'tool_execution',
        status: 'failed',
        toolName: name,
        durationMs: Date.now() - startedAt,
        errorCode: appError.code,
        inputSummary,
      });

      throw error;
    }
  }

  private summarizeInput(input: unknown): Record<string, unknown> {
    return this.summarizeRecord(input);
  }

  private summarizeOutput(output: unknown): Record<string, unknown> {
    return this.summarizeRecord(output);
  }

  private summarizeRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        kind: Array.isArray(value) ? 'array' : typeof value,
      };
    }

    const record = value as Record<string, unknown>;

    return {
      kind: 'object',
      keys: Object.keys(record),
    };
  }
}
