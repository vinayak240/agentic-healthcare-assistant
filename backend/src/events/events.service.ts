import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { EventEnvelope, EventHandler } from './types/event.types';

@Injectable()
export class EventsService {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger(EventsService.name);

  async emit(eventName: string, payload: EventEnvelope): Promise<void> {
    const handlers = this.emitter.listeners(eventName) as EventHandler[];

    const results = await Promise.allSettled(handlers.map((handler) => handler(payload)));

    for (const result of results) {
      if (result.status === 'rejected') {
        const message =
          result.reason instanceof Error ? result.reason.message : 'Event handler failed';
        this.logger.error(`${eventName}: ${message}`);
      }
    }
  }

  on(eventName: string, handler: EventHandler): void {
    this.emitter.on(eventName, handler);
  }
}
