import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { HydratedDocument, Model } from 'mongoose';

import { User } from '../schemas/user.schema';
import { BaseRepository } from './base.repository';

@Injectable()
export class UsersRepository extends BaseRepository<User> {
  constructor(@InjectModel(User.name) userModel: Model<User>) {
    super(userModel);
  }

  async findByEmail(email: string): Promise<HydratedDocument<User> | null> {
    return this.findOne({ email: email.trim().toLowerCase() }).exec();
  }
}
