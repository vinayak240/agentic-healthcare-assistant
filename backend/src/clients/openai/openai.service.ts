import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import {
  createAppException,
  normalizeError,
} from '../../common/errors/app-error';
import { ConfigService } from '../../config/config.service';

interface JsonCompletionResult {
  content: string;
  totalTokens: number;
}

@Injectable()
export class OpenAiService {
  private client: OpenAI | null = null;

  constructor(private readonly configService: ConfigService) {}

  assertConfigured(): void {
    this.getClientOrThrow();
  }

  async createJsonResponse(prompt: string): Promise<JsonCompletionResult> {
    const client = this.getClientOrThrow();

    try {
      const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
      const response = await client.responses.create({
        model,
        input: prompt,
      });
      const rawResponse = response as unknown as {
        output_text?: string;
        usage?: {
          total_tokens?: number;
        };
      };
      const content = rawResponse.output_text?.trim();

      if (!content) {
        throw createAppException('LLM_BAD_RESPONSE');
      }

      return {
        content,
        totalTokens: rawResponse.usage?.total_tokens ?? 0,
      };
    } catch (error) {
      throw normalizeError(error, {
        stage: 'reasoning',
        fallbackCode: 'LLM_UNAVAILABLE',
      });
    }
  }

  async *streamTextResponse(prompt: string): AsyncGenerator<string, JsonCompletionResult> {
    const client = this.getClientOrThrow();

    try {
      const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
      const stream = await client.responses.create({
        model,
        input: prompt,
        stream: true,
      });
      let content = '';
      let totalTokens = 0;

      for await (const event of stream) {
        const typedEvent = event as {
          type?: string;
          delta?: string;
          response?: {
            usage?: {
              total_tokens?: number;
            };
          };
        };

        if (typedEvent.type === 'response.output_text.delta' && typedEvent.delta) {
          content += typedEvent.delta;
          yield typedEvent.delta;
        }

        if (typedEvent.type === 'response.completed') {
          totalTokens = typedEvent.response?.usage?.total_tokens ?? totalTokens;
        }
      }

      const finalContent = content.trim();

      if (!finalContent) {
        throw createAppException('LLM_BAD_RESPONSE');
      }

      return {
        content: finalContent,
        totalTokens,
      };
    } catch (error) {
      throw normalizeError(error, {
        stage: 'rendering',
        fallbackCode: 'LLM_UNAVAILABLE',
      });
    }
  }

  private getClientOrThrow(): OpenAI {
    const apiKey = this.configService.get('OPENAI_KEY');

    if (!apiKey) {
      throw createAppException('LLM_NOT_CONFIGURED');
    }

    if (!this.client) {
      this.client = new OpenAI({ apiKey });
    }

    return this.client;
  }
}
