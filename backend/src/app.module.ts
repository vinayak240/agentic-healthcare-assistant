import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentModule } from './agent/agent.module';
import { ApiModule } from './api/api.module';
import { ChatModule } from './chat/chat.module';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { DalModule } from './dal/dal.module';
import { EventsModule } from './events/events.module';
import { LoggerModule } from './logger/logger.module';
import { ToolModule } from './tool/tool.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow('MONGODB_URI'),
        autoCreate: true,
      }),
    }),
    ApiModule,
    ChatModule,
    AgentModule,
    ToolModule,
    DalModule,
    EventsModule,
    LoggerModule,
  ],
})
export class AppModule {}
