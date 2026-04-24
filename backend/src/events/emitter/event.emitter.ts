import { Injectable, Optional } from '@nestjs/common';
import { EventsService } from '../events.service';
import { AppEvent } from '../types/event.types';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class AppEventEmitter {
  private readonly logger: LoggerService;

  constructor(
    private readonly eventsService: EventsService,
    @Optional() logger: LoggerService = new LoggerService(),
  ) {
    this.logger = logger.child({
      component: AppEventEmitter.name,
    });
  }

  emitEvent(event: AppEvent): Promise<void> {
    this.logger.debug('events.app.emit', {
      stage: 'system',
      operation: 'emit_event',
      status: 'emitting',
      userId: event.userId,
      conversationId: event.conversationId,
      runId: event.runId,
      eventType: event.type,
      source: event.source,
    });

    return this.eventsService.emit('app.event', { event });
  }
}
