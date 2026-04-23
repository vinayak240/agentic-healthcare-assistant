import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

import type { CudFoil } from '../interfaces/cud-foil.interface';
import { Conversation } from './conversation.schema';
import { Run } from './run.schema';
import { cudFoilProp, timestampOptions } from './schema.constants';
import { User } from './user.schema';

@Schema({
  collection: 'usages',
  timestamps: timestampOptions,
})
export class Usage {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Conversation.name, required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Run.name, required: true, index: true })
  runId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  totalTokens!: number;

  @Prop(cudFoilProp)
  cudFoil!: CudFoil;
}

export type UsageDocument = HydratedDocument<Usage>;

export const UsageSchema = SchemaFactory.createForClass(Usage);

