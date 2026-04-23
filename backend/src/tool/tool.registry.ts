import { Injectable } from '@nestjs/common';

export interface Tool {
  name: string;
  description?: string;
  execute: (input: unknown) => unknown;
}

@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }
}
