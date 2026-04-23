import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Conversation } from '../schemas/conversation.schema';
import { BaseRepository } from './base.repository';

@Injectable()
export class ConversationsRepository extends BaseRepository<Conversation> {
  constructor(@InjectModel(Conversation.name) conversationModel: Model<Conversation>) {
    super(conversationModel);
  }
}

