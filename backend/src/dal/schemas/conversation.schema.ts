import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

import type { CudFoil } from '../interfaces/cud-foil.interface';
import { cudFoilProp, timestampOptions } from './schema.constants';
import { User } from './user.schema';

@Schema({
  collection: 'conversations',
  timestamps: timestampOptions,
})
export class Conversation {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ type: Date, required: true })
  lastMessageAt!: Date;

  @Prop(cudFoilProp)
  cudFoil!: CudFoil;
}

export type ConversationDocument = HydratedDocument<Conversation>;

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

