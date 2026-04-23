import type { EventPayload as DalEventPayload, EventSource, EventType } from '../../dal/interfaces/dal.types';

export interface AppEvent {
  userId: string;
  conversationId: string;
  runId: string;
  source: EventSource;
  type: EventType;
  payload?: DalEventPayload;
}

export interface EventEnvelope {
  event: AppEvent;
}

export type EventHandler = (payload: EventEnvelope) => Promise<void> | void;
