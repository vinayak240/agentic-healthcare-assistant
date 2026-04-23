import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Usage } from '../schemas/usage.schema';
import { BaseRepository } from './base.repository';

@Injectable()
export class UsagesRepository extends BaseRepository<Usage> {
  constructor(@InjectModel(Usage.name) usageModel: Model<Usage>) {
    super(usageModel);
  }
}

