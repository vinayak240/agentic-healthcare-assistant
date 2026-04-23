import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

import type { EventPayload, EventSource, EventType } from '../interfaces/dal.types';
import { Conversation } from './conversation.schema';
import { Run } from './run.schema';
import { User } from './user.schema';

@Schema({
  collection: 'events',
})
export class Event {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Conversation.name, required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Run.name, required: true, index: true })
  runId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['agent', 'user', 'system'],
  })
  source!: EventSource;

  @Prop({
    type: String,
    required: true,
    enum: [
      'run_started',
      'llm_called',
      'tool_called',
      'tool_result',
      'message_created',
      'run_completed',
      'run_failed',
    ],
  })
  type!: EventType;

  @Prop({
    type: {
      input: { type: String },
      output: { type: String },
      toolName: { type: String },
      toolData: { type: Object },
      error: { type: String },
    },
    default: () => ({}),
    _id: false,
  })
  payload!: EventPayload;

  @Prop({ type: Date, required: true, default: Date.now })
  createdAt!: Date;
}

export type EventDocument = HydratedDocument<Event>;

export const EventSchema = SchemaFactory.createForClass(Event);
