import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { DalModule } from '../dal/dal.module';
import { ChatController } from './controllers/chat.controller';
import { ConversationController } from './controllers/conversation.controller';
import { RunController } from './controllers/run.controller';
import { SystemController } from './controllers/system.controller';
import { UserController } from './controllers/user.controller';
import { UsageController } from './controllers/usage.controller';
import {
  ConversationService,
  RunService,
  SystemService,
  UsageService,
  UserService,
} from './services';

@Module({
  imports: [ChatModule, DalModule],
  controllers: [
    ChatController,
    ConversationController,
    RunController,
    UsageController,
    SystemController,
    UserController,
  ],
  providers: [ConversationService, RunService, UsageService, SystemService, UserService],
})
export class ApiModule {}
