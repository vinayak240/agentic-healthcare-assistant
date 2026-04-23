import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { EventHandler, EventPayload } from './types/event.types';

@Injectable()
export class EventsService {
  private readonly emitter = new EventEmitter();

  emit(eventName: string, payload: EventPayload): void {
    this.emitter.emit(eventName, payload);
  }

  on(eventName: string, handler: EventHandler): void {
    this.emitter.on(eventName, handler);
  }
}
