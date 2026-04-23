import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

import type { CudFoil } from '../interfaces/cud-foil.interface';
import type { RunStatus } from '../interfaces/dal.types';
import { Conversation } from './conversation.schema';
import { cudFoilProp, timestampOptions } from './schema.constants';
import { User } from './user.schema';

@Schema({
  collection: 'runs',
  timestamps: timestampOptions,
})
export class Run {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Conversation.name, required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['running', 'completed', 'failed'],
  })
  status!: RunStatus;

  @Prop({ type: Date, required: true })
  startedAt!: Date;

  @Prop({ type: Date, default: null })
  endedAt!: Date | null;

  @Prop(cudFoilProp)
  cudFoil!: CudFoil;
}

export type RunDocument = HydratedDocument<Run>;

export const RunSchema = SchemaFactory.createForClass(Run);
