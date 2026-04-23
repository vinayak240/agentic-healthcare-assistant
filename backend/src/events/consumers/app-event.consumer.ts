import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventsRepository } from '../../dal/repositories/events.repository';
import type { EventType } from '../../dal/interfaces/dal.types';
import type { EventDocument } from '../../dal/schemas/event.schema';
import { EventsService } from '../events.service';
import type { AppEvent } from '../types/event.types';
import { UsageProjectorService } from '../usage-projector.service';
import { BaseConsumer } from './base.consumer';

@Injectable()
export class AppEventConsumer extends BaseConsumer implements OnModuleInit {
  private readonly handlers: Record<EventType, (event: AppEvent) => Promise<void>> = {
    run_started: (event) => this.persistOnly(event),
    llm_called: (event) => this.persistOnly(event),
    tool_called: (event) => this.persistOnly(event),
    tool_result: (event) => this.persistOnly(event),
    message_created: (event) => this.persistOnly(event),
    usage_final: (event) => this.handleUsageFinal(event),
    run_completed: (event) => this.persistOnly(event),
    run_failed: (event) => this.persistOnly(event),
  };

  constructor(
    private readonly eventsService: EventsService,
    private readonly eventsRepository: EventsRepository,
    private readonly usageProjectorService: UsageProjectorService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.eventsService.on('app.event', (payload) => this.consume('app.event', payload));
  }

  async consume(_eventName: string, payload: unknown): Promise<void> {
    if (!this.isAppEventEnvelope(payload)) {
      return;
    }

    const handler = this.handlers[payload.event.type];

    await handler(payload.event);
  }

  private async persistOnly(event: AppEvent): Promise<void> {
    await this.persistEvent(event);
  }

  private async handleUsageFinal(event: AppEvent): Promise<void> {
    const persistedEvent = await this.persistEvent(event);
    await this.usageProjectorService.projectUsage(persistedEvent);
  }

  private persistEvent(event: AppEvent): Promise<EventDocument> {
    return this.eventsRepository.create({
      userId: event.userId as never,
      conversationId: event.conversationId as never,
      runId: event.runId as never,
      source: event.source,
      type: event.type,
      payload: event.payload ?? {},
    });
  }

  private isAppEventEnvelope(value: unknown): value is { event: AppEvent } {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    if (!candidate.event || typeof candidate.event !== 'object') {
      return false;
    }

    const event = candidate.event as Record<string, unknown>;

    return (
      typeof event.userId === 'string' &&
      typeof event.conversationId === 'string' &&
      typeof event.runId === 'string' &&
      typeof event.source === 'string' &&
      typeof event.type === 'string'
    );
  }
}
