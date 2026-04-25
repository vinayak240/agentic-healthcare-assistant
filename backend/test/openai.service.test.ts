import { describe, expect, it } from 'bun:test';
import OpenAI from 'openai';
import { OpenAiService } from '../src/clients/openai/openai.service';

describe('OpenAiService', () => {
  it('throws LLM_NOT_CONFIGURED when the API key is missing', () => {
    const service = new OpenAiService({
      get(key: string) {
        return key === 'OPENAI_KEY' ? undefined : null;
      },
    } as never, silentLogger as never);

    expect(() => service.assertConfigured()).toThrow();

    try {
      service.assertConfigured();
    } catch (error) {
      expect(error).toMatchObject({
        appError: expect.objectContaining({
          code: 'LLM_NOT_CONFIGURED',
          statusCode: 500,
        }),
      });
    }
  });

  it('maps provider rate limits to LLM_RATE_LIMITED', async () => {
    const service = createServiceWithClient({
      async create() {
        throw new OpenAI.RateLimitError(
          429,
          { message: 'rate limited' },
          undefined,
          new Headers(),
        );
      },
    });

    await expect(service.createJsonResponse('prompt')).rejects.toMatchObject({
      code: 'LLM_RATE_LIMITED',
      statusCode: 429,
    });
  });

  it('maps provider timeouts to LLM_TIMEOUT', async () => {
    const service = createServiceWithClient({
      async create() {
        throw new OpenAI.APIConnectionTimeoutError({
          message: 'timed out',
        });
      },
    });

    await expect(service.createJsonResponse('prompt')).rejects.toMatchObject({
      code: 'LLM_TIMEOUT',
      statusCode: 504,
    });
  });

  it('maps provider availability failures to LLM_UNAVAILABLE', async () => {
    const service = createServiceWithClient({
      async create() {
        throw new OpenAI.InternalServerError(
          503,
          { message: 'down' },
          undefined,
          new Headers(),
        );
      },
    });

    await expect(service.createJsonResponse('prompt')).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('maps empty provider responses to LLM_BAD_RESPONSE', async () => {
    const service = createServiceWithClient({
      async create() {
        return {
          output_text: '',
          usage: {
            total_tokens: 0,
          },
        };
      },
    });

    await expect(service.createJsonResponse('prompt')).rejects.toMatchObject({
      code: 'LLM_BAD_RESPONSE',
      statusCode: 502,
    });
  });

  it('logs OpenAI requests without leaking the raw prompt text', async () => {
    const entries: string[] = [];
    const service = createServiceWithClient({
      async create() {
        return {
          output_text: '{"ok":true}',
          usage: {
            total_tokens: 12,
          },
        };
      },
    }, createMemoryLogger(entries));

    await service.createJsonResponse('very sensitive symptom prompt');

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.includes('very sensitive symptom prompt'))).toBe(false);
    expect(entries.some((entry) => entry.includes('"promptLength":'))).toBe(true);
  });
});

const silentLogger = {
  child() {
    return this;
  },
  debug() {
    return undefined;
  },
  error() {
    return undefined;
  },
  info() {
    return undefined;
  },
  warn() {
    return undefined;
  },
};

function createMemoryLogger(entries: string[]) {
  return {
    ...silentLogger,
    debug(event: string, metadata: Record<string, unknown> = {}) {
      entries.push(JSON.stringify({ event, ...metadata }));
    },
  };
}

function createServiceWithClient(
  create: { create: (input: unknown) => Promise<unknown> },
  logger: typeof silentLogger = silentLogger,
) {
  const service = new OpenAiService({
    get(key: string) {
      if (key === 'OPENAI_KEY') {
        return 'test-key';
      }

      if (key === 'OPENAI_MODEL') {
        return 'gpt-test';
      }

      return null;
    },
  } as never, logger as never);

  (service as unknown as { client: unknown }).client = {
    responses: create,
  };

  return service;
}
