import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import type { CudFoil } from '../interfaces/cud-foil.interface';
import { cudFoilProp, timestampOptions } from './schema.constants';

@Schema({
  collection: 'users',
  timestamps: timestampOptions,
})
export class User {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email!: string;

  @Prop(cudFoilProp)
  cudFoil!: CudFoil;
}

export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);

