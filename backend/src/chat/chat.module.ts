import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { DalModule } from '../dal/dal.module';
import { ChatService } from './chat.service';

@Module({
  imports: [DalModule, AgentModule],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
