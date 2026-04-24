import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

import type { CudFoil } from '../interfaces/cud-foil.interface';
import type { MessageContent, MessageRole } from '../interfaces/dal.types';
import { Conversation } from './conversation.schema';
import { Run } from './run.schema';
import { cudFoilProp, timestampOptions } from './schema.constants';
import { User } from './user.schema';

@Schema({
  collection: 'messages',
  timestamps: timestampOptions,
})
export class Message {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Conversation.name, required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Run.name, required: true, index: true })
  runId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['system', 'user', 'assistant'],
  })
  role!: MessageRole;

  @Prop({
    type: {
      text: { type: String, required: true },
      metadata: {
        type: {
          kind: { type: String },
          handoffRunId: { type: String },
          toolName: { type: String },
          specialty: { type: String },
          reason: { type: String },
          doctorName: { type: String },
          phone: { type: String },
          modelName: { type: String },
          totalTokens: { type: Number },
          costUsd: { type: Number },
          audio: {
            type: {
              status: { type: String },
              provider: { type: String },
              model: { type: String },
              voice: { type: String },
              generatedAt: { type: String },
              chunks: [
                {
                  index: { type: Number, required: true },
                  objectKey: { type: String, required: true },
                  contentType: { type: String, required: true },
                  _id: false,
                },
              ],
            },
            required: false,
            _id: false,
          },
        },
        required: false,
        _id: false,
      },
    },
    required: true,
    _id: false,
  })
  content!: MessageContent;

  @Prop(cudFoilProp)
  cudFoil!: CudFoil;
}

export type MessageDocument = HydratedDocument<Message>;

export const MessageSchema = SchemaFactory.createForClass(Message);
