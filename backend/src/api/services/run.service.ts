import { Injectable, NotFoundException } from '@nestjs/common';
import { RunsRepository } from '../../dal/repositories/runs.repository';

@Injectable()
export class RunService {
  constructor(private readonly runsRepository: RunsRepository) {}

  async getRun(id: string) {
    const run = await this.runsRepository.findById(id);

    if (!run) {
      throw new NotFoundException('Run not found');
    }

    return {
      id: run._id.toString(),
      userId: String(run.userId),
      conversationId: String(run.conversationId),
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt?.toISOString() ?? null,
      createdAt: run.cudFoil.createdAt?.toISOString() ?? null,
      updatedAt: run.cudFoil.updatedAt?.toISOString() ?? null,
    };
  }
}
