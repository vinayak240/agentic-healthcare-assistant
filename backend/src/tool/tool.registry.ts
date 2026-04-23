import { Injectable } from '@nestjs/common';
import type { ToolDefinition, ToolDescriptor } from './tool.types';

@Injectable()
export class ToolRegistry {
  // The registry stores concrete tool instances by stable tool name so the agent loop
  // can discover and execute tools dynamically.
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    this.tools.set(tool.name, tool as ToolDefinition<unknown, unknown>);
  }

  get<TInput, TOutput>(name: string): ToolDefinition<TInput, TOutput> {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Tool not registered: ${name}`);
    }

    return tool as ToolDefinition<TInput, TOutput>;
  }

  async execute<TInput, TOutput>(name: string, input: TInput): Promise<TOutput> {
    const tool = this.get<TInput, TOutput>(name);

    return tool.execute(input);
  }

  list(): ToolDescriptor[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputType: tool.inputType,
      outputType: tool.outputType,
      inputSchema: tool.inputSchema,
    }));
  }
}
