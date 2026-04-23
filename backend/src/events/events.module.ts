import { Module } from '@nestjs/common';
import { AppEventEmitter } from './emitter/event.emitter';
import { EventsService } from './events.service';

@Module({
  providers: [EventsService, AppEventEmitter],
  exports: [EventsService, AppEventEmitter],
})
export class EventsModule {}
