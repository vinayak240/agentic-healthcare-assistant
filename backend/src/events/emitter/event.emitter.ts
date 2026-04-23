import { Injectable } from '@nestjs/common';
import { EventsService } from '../events.service';
import { AppEvent } from '../types/event.types';

@Injectable()
export class AppEventEmitter {
  constructor(private readonly eventsService: EventsService) {}

  emitEvent(event: AppEvent): Promise<void> {
    return this.eventsService.emit('app.event', { event });
  }
}
