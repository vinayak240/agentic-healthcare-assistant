import { Module } from '@nestjs/common';
import { DalModule } from '../dal/dal.module';
import { AppEventConsumer } from './consumers/app-event.consumer';
import { AppEventEmitter } from './emitter/event.emitter';
import { EventsService } from './events.service';
import { UsageProjectorService } from './usage-projector.service';

@Module({
  imports: [DalModule],
  providers: [EventsService, AppEventEmitter, AppEventConsumer, UsageProjectorService],
  exports: [EventsService, AppEventEmitter, UsageProjectorService],
})
export class EventsModule {}
