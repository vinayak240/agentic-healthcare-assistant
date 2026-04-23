import { describe, expect, it } from 'bun:test';
import { UsageProjectorService } from '../src/events/usage-projector.service';

describe('UsageProjectorService', () => {
  it('creates usage from the first usage_final event', async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const service = new UsageProjectorService({
      async upsertByRunId(input: Record<string, unknown>) {
        upsertCalls.push(input);
        return input;
      },
    } as never);

    await service.projectUsage({
      userId: '507f1f77bcf86cd799439011',
      conversationId: '507f1f77bcf86cd799439012',
      runId: '507f1f77bcf86cd799439013',
      type: 'usage_final',
      payload: {
        totalTokens: 144,
      },
    } as never);

    expect(upsertCalls).toEqual([
      {
        userId: '507f1f77bcf86cd799439011',
        conversationId: '507f1f77bcf86cd799439012',
        runId: '507f1f77bcf86cd799439013',
        totalTokens: 144,
      },
    ]);
  });

  it('reprocesses the same run id without creating duplicate logical usage rows', async () => {
    const usageByRunId = new Map<string, number>();
    const service = new UsageProjectorService({
      async upsertByRunId(input: Record<string, unknown>) {
        usageByRunId.set(String(input.runId), Number(input.totalTokens));
        return input;
      },
    } as never);

    const event = {
      userId: '507f1f77bcf86cd799439011',
      conversationId: '507f1f77bcf86cd799439012',
      runId: '507f1f77bcf86cd799439013',
      type: 'usage_final',
      payload: {
        totalTokens: 144,
      },
    };

    await service.projectUsage(event as never);
    await service.projectUsage(event as never);

    expect(usageByRunId.size).toBe(1);
    expect(usageByRunId.get('507f1f77bcf86cd799439013')).toBe(144);
  });

  it('updates an existing usage row when the same run is projected again', async () => {
    const usageByRunId = new Map<string, number>([['507f1f77bcf86cd799439013', 144]]);
    const service = new UsageProjectorService({
      async upsertByRunId(input: Record<string, unknown>) {
        usageByRunId.set(String(input.runId), Number(input.totalTokens));
        return input;
      },
    } as never);

    await service.projectUsage({
      userId: '507f1f77bcf86cd799439011',
      conversationId: '507f1f77bcf86cd799439012',
      runId: '507f1f77bcf86cd799439013',
      type: 'usage_final',
      payload: {
        totalTokens: 188,
      },
    } as never);

    expect(usageByRunId.size).toBe(1);
    expect(usageByRunId.get('507f1f77bcf86cd799439013')).toBe(188);
  });
});
