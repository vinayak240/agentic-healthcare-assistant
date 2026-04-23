import { Injectable } from '@nestjs/common';
import { ToolRegistry } from './tool.registry';

@Injectable()
export class ToolService {
  constructor(private readonly toolRegistry: ToolRegistry) {}

  listTools() {
    return this.toolRegistry.list();
  }
}
