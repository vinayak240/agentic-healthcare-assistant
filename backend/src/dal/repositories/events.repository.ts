import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';

import { Event } from '../schemas/event.schema';

type CreateEventInput = Omit<Event, 'createdAt'> & {
  createdAt?: Date;
};

@Injectable()
export class EventsRepository {
  constructor(@InjectModel(Event.name) private readonly eventModel: Model<Event>) {}

  async create(input: CreateEventInput): Promise<HydratedDocument<Event>> {
    return this.eventModel.create(input);
  }

  async findById(id: string): Promise<HydratedDocument<Event> | null> {
    return this.eventModel.findById(id).exec();
  }

  async findMany(filter: FilterQuery<Event> = {}): Promise<Array<HydratedDocument<Event>>> {
    return this.eventModel.find(filter).exec();
  }
}

