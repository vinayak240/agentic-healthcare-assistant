import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { LoggerService } from '../logger/logger.service';
import { EventEnvelope, EventHandler } from './types/event.types';

@Injectable()
export class EventsService {
  private readonly emitter = new EventEmitter();
  private readonly logger: LoggerService;

  constructor(@Optional() logger: LoggerService = new LoggerService()) {
    this.logger = logger.child({
      component: EventsService.name,
    });
  }

  async emit(eventName: string, payload: EventEnvelope): Promise<void> {
    const handlers = this.emitter.listeners(eventName) as EventHandler[];

    this.logger.debug('events.emit.started', {
      stage: 'system',
      operation: 'event_emit',
      status: 'started',
      eventName,
      handlerCount: handlers.length,
      eventType: payload.event.type,
      runId: payload.event.runId,
      conversationId: payload.event.conversationId,
      userId: payload.event.userId,
    });

    const results = await Promise.allSettled(handlers.map((handler) => handler(payload)));

    this.logger.debug('events.emit.completed', {
      stage: 'system',
      operation: 'event_emit',
      status: 'completed',
      eventName,
      handlerCount: handlers.length,
      rejectedHandlers: results.filter((result) => result.status === 'rejected').length,
      eventType: payload.event.type,
      runId: payload.event.runId,
      conversationId: payload.event.conversationId,
      userId: payload.event.userId,
    });

    for (const result of results) {
      if (result.status === 'rejected') {
        const message =
          result.reason instanceof Error ? result.reason.message : 'Event handler failed';
        this.logger.error('events.emit.handler_failed', {
          stage: 'system',
          operation: 'event_emit',
          status: 'failed',
          eventName,
          eventType: payload.event.type,
          runId: payload.event.runId,
          conversationId: payload.event.conversationId,
          userId: payload.event.userId,
          reason: message,
        });
      }
    }
  }

  on(eventName: string, handler: EventHandler): void {
    this.emitter.on(eventName, handler);
  }
}
