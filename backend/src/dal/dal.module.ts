import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  Conversation,
  ConversationSchema,
  Event,
  EventSchema,
  Message,
  MessageSchema,
  Run,
  RunSchema,
  Usage,
  UsageSchema,
  User,
  UserSchema,
} from './schemas';
import {
  ConversationsRepository,
  EventsRepository,
  MessagesRepository,
  RunsRepository,
  UsagesRepository,
  UsersRepository,
} from './repositories';
import { DalCollectionsInitializer } from './dal-collections.initializer';

const repositories = [
  UsersRepository,
  ConversationsRepository,
  RunsRepository,
  MessagesRepository,
  EventsRepository,
  UsagesRepository,
];

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Run.name, schema: RunSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Event.name, schema: EventSchema },
      { name: Usage.name, schema: UsageSchema },
    ]),
  ],
  providers: [...repositories, DalCollectionsInitializer],
  exports: repositories,
})
export class DalModule {}
