import { Injectable } from '@nestjs/common';
import { UsagesRepository } from '../dal/repositories/usages.repository';
import type { EventDocument } from '../dal/schemas/event.schema';

@Injectable()
export class UsageProjectorService {
  constructor(private readonly usagesRepository: UsagesRepository) {}

  async projectUsage(event: EventDocument): Promise<void> {
    const totalTokens = event.payload.totalTokens;

    if (typeof totalTokens !== 'number' || !Number.isFinite(totalTokens) || totalTokens < 0) {
      return;
    }

    await this.usagesRepository.upsertByRunId({
      userId: String(event.userId),
      conversationId: String(event.conversationId),
      runId: String(event.runId),
      totalTokens,
    });
  }
}
