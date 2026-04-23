import type { StructuredSseEvent } from './chat.types';

export function createSseEvent<TData extends object>(
  runId: string,
  type: string,
  data: TData,
): StructuredSseEvent<TData> {
  return {
    type,
    runId,
    timestamp: new Date().toISOString(),
    data,
  };
}

export function formatSseEvent(event: StructuredSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
