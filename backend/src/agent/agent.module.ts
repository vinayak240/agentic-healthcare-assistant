import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { DalModule } from '../dal/dal.module';
import { EventsModule } from '../events/events.module';
import { ToolModule } from '../tool/tool.module';
import { AgentService } from './agent.service';

@Module({
  // The agent orchestrates both shared clients and registered tools, while persisting
  // conversation-aware behavior through DAL access.
  imports: [ClientsModule, ToolModule, DalModule, EventsModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
