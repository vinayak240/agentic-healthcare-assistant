import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';

import { Conversation } from '../schemas/conversation.schema';
import { BaseRepository } from './base.repository';

export interface ConversationCursorInput {
  lastMessageAt: Date;
  id: string;
}

@Injectable()
export class ConversationsRepository extends BaseRepository<Conversation> {
  constructor(@InjectModel(Conversation.name) conversationModel: Model<Conversation>) {
    super(conversationModel);
  }

  async findPageByUserId(params: {
    userId: string;
    limit: number;
    cursor?: ConversationCursorInput;
  }): Promise<Array<HydratedDocument<Conversation>>> {
    const { cursor, limit, userId } = params;
    const filter: FilterQuery<Conversation> = {
      userId,
    };

    if (cursor) {
      filter.$or = [
        { lastMessageAt: { $lt: cursor.lastMessageAt } },
        {
          lastMessageAt: cursor.lastMessageAt,
          _id: { $lt: cursor.id },
        },
      ];
    }

    return this.model
      .find({
        ...filter,
        'cudFoil.deleted': false,
      })
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(limit)
      .exec();
  }
}
