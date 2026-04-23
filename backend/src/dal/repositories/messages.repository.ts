import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';

import { Message } from '../schemas/message.schema';
import { BaseRepository } from './base.repository';

export interface MessageCursorInput {
  createdAt: Date;
  id: string;
}

@Injectable()
export class MessagesRepository extends BaseRepository<Message> {
  constructor(@InjectModel(Message.name) messageModel: Model<Message>) {
    super(messageModel);
  }

  async findByConversationId(conversationId: string): Promise<Array<HydratedDocument<Message>>> {
    return this.model
      .find({
        conversationId,
        'cudFoil.deleted': false,
      })
      .sort({ 'cudFoil.createdAt': 1, _id: 1 })
      .exec();
  }

  async findPageByConversationId(params: {
    conversationId: string;
    limit: number;
    cursor?: MessageCursorInput;
  }): Promise<Array<HydratedDocument<Message>>> {
    const { conversationId, cursor, limit } = params;
    const filter: FilterQuery<Message> = {
      conversationId,
    };

    if (cursor) {
      filter.$or = [
        { 'cudFoil.createdAt': { $lt: cursor.createdAt } },
        {
          'cudFoil.createdAt': cursor.createdAt,
          _id: { $lt: cursor.id },
        },
      ];
    }

    return this.model
      .find({
        ...filter,
        'cudFoil.deleted': false,
      })
      .sort({ 'cudFoil.createdAt': -1, _id: -1 })
      .limit(limit)
      .exec();
  }
}
