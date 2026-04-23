import { Injectable } from '@nestjs/common';
import type { HydratedDocument } from 'mongoose';
import { UsagesRepository } from '../../dal/repositories/usages.repository';
import type { Usage } from '../../dal/schemas/usage.schema';

@Injectable()
export class UsageService {
  constructor(private readonly usagesRepository: UsagesRepository) {}

  async getRunUsage(runId: string) {
    const usage = await this.usagesRepository.findByRunId(runId);

    if (!usage) {
      return null;
    }

    return this.serializeUsage(usage);
  }

  async getUserUsage(params: { userId: string; from?: string; to?: string }) {
    const from = params.from ? new Date(params.from) : undefined;
    const to = params.to ? new Date(params.to) : undefined;
    const items = await this.usagesRepository.findByUserIdAndRange({
      userId: params.userId,
      from,
      to,
    });

    return {
      userId: params.userId,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      totalTokens: items.reduce((sum, item) => sum + item.totalTokens, 0),
      items: items.map((usage) => this.serializeUsage(usage)),
    };
  }

  private serializeUsage(usage: HydratedDocument<Usage>) {
    return {
      id: usage._id.toString(),
      userId: String(usage.userId),
      conversationId: String(usage.conversationId),
      runId: String(usage.runId),
      totalTokens: usage.totalTokens,
      createdAt: usage.cudFoil.createdAt?.toISOString() ?? null,
      updatedAt: usage.cudFoil.updatedAt?.toISOString() ?? null,
    };
  }
}
