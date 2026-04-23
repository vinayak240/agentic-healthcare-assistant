import { Module } from '@nestjs/common';
import { ToolRegistry } from './tool.registry';
import { ToolService } from './tool.service';

@Module({
  providers: [ToolService, ToolRegistry],
  exports: [ToolService, ToolRegistry],
})
export class ToolModule {}
