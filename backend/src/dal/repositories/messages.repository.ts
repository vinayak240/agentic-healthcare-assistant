import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Message } from '../schemas/message.schema';
import { BaseRepository } from './base.repository';

@Injectable()
export class MessagesRepository extends BaseRepository<Message> {
  constructor(@InjectModel(Message.name) messageModel: Model<Message>) {
    super(messageModel);
  }
}

