import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ChatController } from './controllers/chat.controller';

@Module({
  imports: [ChatModule],
  controllers: [ChatController],
})
export class ApiModule {}
