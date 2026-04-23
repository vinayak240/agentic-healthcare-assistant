import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { HydratedDocument, Model } from 'mongoose';

import { Run } from '../schemas/run.schema';
import { BaseRepository } from './base.repository';

@Injectable()
export class RunsRepository extends BaseRepository<Run> {
  constructor(@InjectModel(Run.name) runModel: Model<Run>) {
    super(runModel);
  }

  async findByConversationId(conversationId: string): Promise<Array<HydratedDocument<Run>>> {
    return this.model
      .find({
        conversationId,
        'cudFoil.deleted': false,
      })
      .sort({ startedAt: -1, _id: -1 })
      .exec();
  }
}
