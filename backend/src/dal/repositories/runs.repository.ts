import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Run } from '../schemas/run.schema';
import { BaseRepository } from './base.repository';

@Injectable()
export class RunsRepository extends BaseRepository<Run> {
  constructor(@InjectModel(Run.name) runModel: Model<Run>) {
    super(runModel);
  }
}

