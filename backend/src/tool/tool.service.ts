import { Injectable } from '@nestjs/common';
import { ToolRegistry } from './tool.registry';
import type { ToolDescriptor } from './tool.types';
import { BookAppointmentTool } from './tools/book-appointment.tool';
import { DrugInfoTool } from './tools/drug-info.tool';
import { PatientContextTool } from './tools/patient-context.tool';

@Injectable()
export class ToolService {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    patientContextTool: PatientContextTool,
    drugInfoTool: DrugInfoTool,
    bookAppointmentTool: BookAppointmentTool,
  ) {
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
    return this.toolRegistry.execute<TInput, TOutput>(name, input);
  }
}
