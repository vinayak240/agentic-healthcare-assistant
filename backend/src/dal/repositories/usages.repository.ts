import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { HydratedDocument, Model } from 'mongoose';

import { Usage } from '../schemas/usage.schema';
import { BaseRepository } from './base.repository';

export interface UsageRangeInput {
  userId: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class UsagesRepository extends BaseRepository<Usage> {
  constructor(@InjectModel(Usage.name) usageModel: Model<Usage>) {
    super(usageModel);
  }

  async findByRunId(runId: string): Promise<HydratedDocument<Usage> | null> {
    return this.findOne({ runId }).exec();
  }

  async findByUserIdAndRange(params: UsageRangeInput): Promise<Array<HydratedDocument<Usage>>> {
    const { from, to, userId } = params;
    const createdAtFilter: Record<string, Date> = {};

    if (from) {
      createdAtFilter.$gte = from;
    }

    if (to) {
      createdAtFilter.$lte = to;
    }

    const filter = {
      userId,
      ...(Object.keys(createdAtFilter).length > 0
        ? { 'cudFoil.createdAt': createdAtFilter }
        : {}),
    };

    return this.model
      .find({
        ...filter,
        'cudFoil.deleted': false,
      })
      .sort({ 'cudFoil.createdAt': -1, _id: -1 })
      .exec();
  }

  async sumTotalTokens(): Promise<number> {
    const [summary] = await this.model
      .aggregate<{ totalTokens: number }>([
        {
          $match: {
            'cudFoil.deleted': false,
          },
        },
        {
          $group: {
            _id: null,
            totalTokens: { $sum: '$totalTokens' },
          },
        },
      ])
      .exec();

    return summary?.totalTokens ?? 0;
  }

  async upsertByRunId(input: {
    userId: string;
    conversationId: string;
    runId: string;
    totalTokens: number;
  }): Promise<HydratedDocument<Usage>> {
    return this.model
      .findOneAndUpdate(
        {
          runId: input.runId,
          'cudFoil.deleted': false,
        },
        {
          $set: {
            userId: input.userId,
            conversationId: input.conversationId,
            totalTokens: input.totalTokens,
          },
          $setOnInsert: {
            runId: input.runId,
            'cudFoil.deleted': false,
            'cudFoil.deletedAt': null,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      )
      .exec() as Promise<HydratedDocument<Usage>>;
  }
}
