import { Injectable } from '@nestjs/common';
import { EventsService } from '../events.service';
import { EventPayload } from '../types/event.types';

@Injectable()
export class AppEventEmitter {
  constructor(private readonly eventsService: EventsService) {}

  emitUserEvent(payload: EventPayload): void {
    this.eventsService.emit('user.event', payload);
  }

  emitAgentEvent(payload: EventPayload): void {
    this.eventsService.emit('agent.event', payload);
  }
}
