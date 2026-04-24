import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { EventsRepository } from '../../dal/repositories/events.repository';
import type { EventType } from '../../dal/interfaces/dal.types';
import type { EventDocument } from '../../dal/schemas/event.schema';
import { LoggerService } from '../../logger/logger.service';
import { EventsService } from '../events.service';
import type { AppEvent } from '../types/event.types';
import { UsageProjectorService } from '../usage-projector.service';
import { BaseConsumer } from './base.consumer';

@Injectable()
export class AppEventConsumer extends BaseConsumer implements OnModuleInit {
  private readonly logger: LoggerService;
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
    @Optional() logger: LoggerService = new LoggerService(),
  ) {
    super();
    this.logger = logger.child({
      component: AppEventConsumer.name,
    });
  }

  onModuleInit(): void {
    this.eventsService.on('app.event', (payload) => this.consume('app.event', payload));
  }

  async consume(_eventName: string, payload: unknown): Promise<void> {
    if (!this.isAppEventEnvelope(payload)) {
      this.logger.warn('events.consumer.ignored_payload', {
        stage: 'system',
        operation: 'consume_event',
        status: 'ignored',
      });
      return;
    }

    const handler = this.handlers[payload.event.type];

    this.logger.debug('events.consumer.received', {
      stage: 'system',
      operation: 'consume_event',
      status: 'received',
      eventType: payload.event.type,
      runId: payload.event.runId,
      conversationId: payload.event.conversationId,
      userId: payload.event.userId,
    });

    await handler(payload.event);
  }

  private async persistOnly(event: AppEvent): Promise<void> {
    await this.persistEvent(event);
  }

  private async handleUsageFinal(event: AppEvent): Promise<void> {
    const persistedEvent = await this.persistEvent(event);
    this.logger.debug('events.consumer.usage_projection.started', {
      stage: 'system',
      operation: 'usage_projection',
      status: 'started',
      eventType: event.type,
      runId: event.runId,
      conversationId: event.conversationId,
      userId: event.userId,
    });
    await this.usageProjectorService.projectUsage(persistedEvent);
    this.logger.debug('events.consumer.usage_projection.completed', {
      stage: 'system',
      operation: 'usage_projection',
      status: 'completed',
      eventType: event.type,
      runId: event.runId,
      conversationId: event.conversationId,
      userId: event.userId,
    });
  }

  private async persistEvent(event: AppEvent): Promise<EventDocument> {
    this.logger.debug('events.consumer.persist.started', {
      stage: 'system',
      operation: 'persist_event',
      status: 'started',
      eventType: event.type,
      runId: event.runId,
      conversationId: event.conversationId,
      userId: event.userId,
    });

    const persisted = await this.eventsRepository.create({
      userId: event.userId as never,
      conversationId: event.conversationId as never,
      runId: event.runId as never,
      source: event.source,
      type: event.type,
      payload: event.payload ?? {},
    });

    this.logger.debug('events.consumer.persist.completed', {
      stage: 'system',
      operation: 'persist_event',
      status: 'completed',
      eventType: event.type,
      runId: event.runId,
      conversationId: event.conversationId,
      userId: event.userId,
    });

    return persisted;
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
